// Rules text, generated from the content data so it is never out of date: unit cards (each soul's relic slot among
// them), ability and status text, room and threat tooltips, reach and Move, relic tips, the synergy tracker and its
// colours, the fusions, the bestiary and the codex (How to play).
import { TUNING } from './tuning.js'
import {
  unitDef, abilityDef, statusDef, relicDef, KIN, ROLES, BEHAVIOURS, SYNERGIES, THREATS, RELIC_TIERS, RELIC_LIST, UNIT_LIST, FUSION_LIST, STATUSES, temperLine
} from './content.js'
import {
  statsOf, activeSynergies, COLS, ROWS, slotAt, rangeOf, isAllyShape, CAMP_ROWS, abilitiesOf, auraOf, tiersOf,
  tileX, tileY, DEPTH, distance, deployTile, behaviourOf, summonsOf, sizeOf, tracksOf, reachOf, meleeOnly
} from './sim/unit.js'
import {
  foeMods, fielded, souls, monarchOf, fieldCap, baseField, commandOf, monarchHp, ariseOf, ariseHeld, unhealed, isMonarch, depthOf, rosterCap,
  inOssuary, canFuse, fuseCost, relicCount, relicTier, floorPrice, isRunPath, isRunRelic, unheld
} from './sim/run.js'
import { heldRules } from './sim/rules.js'
import { basicOf, mendOf, temperOf } from './sim/turns.js'
import { h, fill, icon, portrait, prefs, say } from './dom.js'
import { KEYWORDS, kw, turnsText } from './keywords.js'

const pct = (v) => `${Math.round(v * 100)}%`

// Camp rows by name, front first.
export const campRowLabel = (r) => (r === 0 ? 'Front' : r === CAMP_ROWS - 1 ? 'Rear' : `Row ${r + 1}`)

// ── mods: what a unit really fights with ─────────────────────────────────────────────────────────

// The roles a soul counts as besides its own, for synergies: what its held rules say (Mimicry's Warden), read as the
// battle reads them (turns.js synergiesOf: rules.js `roles`).
export const alsoOf = (u) => heldRules(u).flatMap((r) => r.roles?.(null, u, r) ?? [])

// The pieces of yours standing as the battle begins: the living on the field, the Monarch too.
export const standing = (run) => fielded(run.state.party).filter((u) => u.hp > 0)
// The mods a soul starts a battle with (run.js battleSetup, turns.js modsFor): the run relics' side-wide costs (Legion's
// HP), and the piece relics it holds (redesign.md §2.15). The Monarch takes none: its stats are its own, its HP the
// run's. Synergies bring rules, never mods.
export const partyMods = (run, u = null) => u && isMonarch(u) ? [] : [
  ...run.state.relics.filter(isRunRelic).flatMap((id) => (relicDef(id).mods ?? []).filter((m) => !isRunPath(m.path))),
  ...(u?.relics ?? []).flatMap((id) => relicDef(id).mods ?? [])]

// Foes of a room on the current floor start with the floor's multipliers (their synergies bring rules, no mods).
export const roomFoeMods = (run, node) => foeMods(run.state.floor, node.type === 'boss')

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

// How long a status lasts, an effect's own `turns` or its def's.
const lasts = (e, s) => turnsText(e.turns ?? s.turns)

// An effect in a few words: numbers first, a status as its keyword (its rule is in the glossary).
function effectText (e, st) {
  const est = (power) => Math.round(power * st.atk / TUNING.damage.atkDivisor)
  switch (e.op) {
    case 'damage': return [h('b', null, e.power), ' power ', h('span', { class: 'dim' }, `≈${est(e.power)} pre-DEF`)]
    case 'heal': return [e.self ? 'heals self ' : 'heals ', h('b', null, e.power), h('span', { class: 'dim' }, ` ≈${Math.round(est(e.power) * st.heal.given)} HP`)]
    case 'apply_status': return [kw(e.status, statusDef(e.status).name), ` ${lasts(e, statusDef(e.status))}`]
    case 'cleanse': return `cleanses ${e.count}`
    case 'cooldown': return e.amount < 0 ? `its skills ready ${-e.amount} turn${e.amount === -1 ? '' : 's'} sooner` : `skills rest ${e.amount} turn${e.amount === 1 ? '' : 's'} more (not bosses)`
    case 'raise': return ['raises ', h('b', null, e.count), ' dead as ', kw('shadow', 'shadows')]
    default: return e.op
  }
}

// A melee blow with a range of its own past the tiles beside it says it ("Melee 2"); one without reaches its kind's
// arm, which the card's reach line tells (reachRule).
function reachTag (a) {
  if (a.melee) return h('span', { class: 'tag-melee' }, a.range > 1 ? `Melee ${a.range}` : 'Melee')
  const r = rangeOf(a)
  if (isAllyShape(a.shape) && !Number.isFinite(r)) return null
  return h('span', { class: 'tag-ranged' }, Number.isFinite(r) ? `Range ${r}` : 'Any range')
}

// One ability in one line: name, reach, shape and effects, and on the right whether it is a basic, usable every
// turn, or a skill, which rests a turn (`basic`). Arise (a shape of 'corpse') is a held relic's skill: `arise`, its
// holder's reach and tier ({ domain, tier }), or the line is not drawn at all.
export function abilityBlock (id, st, arise = null, basic = false) {
  const a = abilityDef(id)
  if (a.shape === 'corpse' && !arise) return null
  const word = a.shape === 'all_allies' && Number.isFinite(rangeOf(a)) ? `allies ≤${rangeOf(a)}` : a.shape === 'all' && a.range ? `foes ≤${a.range}` : SHAPE_WORD[a.shape]
  const rest = (n) => (n === 2 ? 'skill · rests a turn' : n <= 1 ? 'skill · no rest' : `skill · rests ${n - 1} turns`)
  return h('div', { class: 'ability' + (a.shape === 'corpse' ? ' arise' : '') },
    h('b', null, a.name), ' ',
    a.shape === 'corpse'
      ? [h('span', { class: 'tag-domain' }, `${arise.domain} tiles`), ` a foe corpse, tier ≤ ${arise.tier} → `, kw('shadow'), ', the corpse you choose']
      : [reachTag(a), word && h('span', { class: 'tag-shape' }, word), ' ', a.effects.map((e, i) => [i ? ' · ' : '', effectText(e, st)]),
          a.cond && h('span', { class: 'dim' }, ` · only ${a.cond}`)],
    h('span', { class: 'ab-cost dim' }, basic ? 'basic' : rest(a.shape === 'corpse' ? arise.cooldown ?? 2 : a.cooldown ?? 2)))
}

// A unit's abilities, each a line (abilityBlock), each saying whether it is a basic, usable every turn, or a skill
// (turns.js basicOf, mendOf); and Arise last for a soul holding an Arise relic (`realm.arise(u)`).
export function abilityBlocks (u, st, realm = null) {
  const kit = abilitiesOf(u).map(abilityDef)
  const basics = [basicOf(kit), mendOf(kit)]
  const arise = realm?.arise?.(u) ?? null
  return [...kit.map((a) => abilityBlock(a.id, st, null, basics.includes(a))), arise && abilityBlock('arise', st, arise)].filter(Boolean)
}

// A unit's aura in one line, under its abilities (a card's, a panel's), or nothing.
export function auraBlock (u) {
  const aura = auraOf(u)
  return aura && h('div', { class: 'ability' }, h('b', null, 'Aura'), ' ', h('span', { class: 'tag-shape' }, `≤${aura.range}`), ' ', aura.desc)
}

// A piece's HP at the stats it fights with (`st`), its wounds kept in proportion: [hp, max]. A summon in battle has
// only its share of a whole one's (turns.js fit: TUNING.summon.hp); a shadow Arise raised rises at full HP.
export function hpAt (u, st) {
  const max = Math.max(1, Math.round(st.hp * (u.summoned ? TUNING.summon.hp : 1)))
  return [u.hp == null ? max : Math.max(0, Math.round(u.hp / (u.maxHp || 1) * max)), max]
}

// The summons a soul's kind's tiers bring it each battle (unit.js summonsOf), in a sentence for its panel; a
// summon brings none. "Brings 2 summons each battle: …".
export function summonText (u) {
  const n = summonsOf(u)
  return [h('b', null, `Brings ${n} `), kw('summon', `summon${n === 1 ? '' : 's'}`), h('b', null, ' each battle'),
    `: ${n === 1 ? 'a shadow' : `${n} shadows`} of its kind rise on the free tiles nearest it at ${pct(TUNING.summon.hp)} of its HP, act on their own, and are gone after the battle.`]
}

// An HP bar, red under 35%, marked dead when empty (a card's, a panel's, a list's).
export function hpBar (hp, max) {
  const f = Math.max(0, Math.min(1, hp / max))
  return h('span', { class: 'hpbar' + (f <= 0 ? ' dead' : f < 0.35 ? ' low' : '') }, h('span', { style: `width:${f * 100}%` }))
}

function statusLine (s) {
  const d = statusDef(s.id)
  return h('span', { class: 'status-line' }, kw(s.id, d.name), s.stacks > 1 ? ` ×${s.stacks}` : '', h('span', { class: 'dim' }, ` ${turnsText(s.dur)}`))
}

// ── Arise and the relic slot ─────────────────────────────────────────────────────────────────────

// Arise as soul `u` holds it (redesign.md §2.15), out of battle: the run's reach and tier (run.js ariseOf: Hourglass,
// Bone Idol), and what the rule of the relic granting it adds on top (Court of Bone's tiles) and how long it rests
// (Blood Tithe's none), as turns.js ariseOf and restOf read them in battle. Null for a soul holding no Arise relic.
export function ariseFor (s, u) {
  const grants = heldRules(u).filter((r) => r.grants === 'arise')
  if (!grants.length) return null
  const a = ariseOf(s)
  const sum = (k) => grants.reduce((n, r) => n + (r.params[k] ?? 0), 0)
  return { domain: a.domain + sum('domain'), tier: a.tier + sum('tier'), cooldown: Math.min(2, ...grants.map((r) => r.params.cooldown ?? 2)) }
}
// What a card reads Arise from: out of battle the run's (ariseFor); a battle passes its own (turns.js ariseOf).
export const realmOf = (run) => ({ arise: (u) => ariseFor(run.state, u) })

// Each relic's own glyph (dom.js PATHS); a Legendary with none wears the wedge, any other the reliquary's.
const RELIC_ICON = {
  whetstone: 'r-whetstone', grave_banner: 'r-banner', soul_lantern: 'r-lantern', hourglass: 'r-hourglass', heartwood: 'r-heartwood',
  tower_shield: 'r-tower', blood_chalice: 'r-chalice', war_drum: 'r-drum', balm: 'r-balm', tithe_bowl: 'r-bowl', grave_ledger: 'r-ledger',
  rite_candle: 'r-candle', binding_chain: 'r-chain', ossuary_key: 'r-key', iron_oath: 'r-oath', arcane_focus: 'r-focus', hunters_mark: 'r-claw',
  bone_idol: 'r-idol', glass_crown: 'r-glass', grave_bell: 'r-bell', rally_horn: 'r-horn'
}
export const relicIcon = (id) => RELIC_ICON[id] ?? (relicDef(id).tier === 'legendary' ? 'legendary' : 'reliquary')

// A soul's relic slot on its card (redesign.md §2.15): each relic it holds, its glyph and name in its tier's colour
// (its rule on hover), and an empty slot while it holds fewer than TUNING.relic.perPiece. Nothing for the Monarch, a
// foe or a shadow, which hold none.
export function relicSlot (u, run = null) {
  const held = u.relics ?? []
  const empty = Math.max(0, TUNING.relic.perPiece - held.length)
  return h('span', { class: 'relic-slot' },
    held.map((id) => h('span', { class: `rs-relic rt-${relicTier(id)}`, tip: () => relicTip(id, run) }, icon(relicIcon(id), 14), relicDef(id).name)),
    Array.from({ length: empty }, () => h('span', { class: 'rs-empty dim', tip: () => 'An empty relic slot: give it a piece relic on the Field, out of battle.' }, '◇ no relic')))
}

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// A relic's name in its tier's colour, its rule on hover.
export const relicName = (id) => h('b', { class: `c-${relicTier(id)}`, tip: () => relicTip(id) }, relicDef(id).name)

// What sets the field size (pieces on the field), as the run has it: "Command 4 (3 + 1 from relics)", and the
// board's cap once Command passes it.
export const fieldRule = (run) => {
  const s = run.state
  const more = commandOf(s) - baseField(s)
  return `Command ${commandOf(s)}${more ? ` (${baseField(s)} + ${more} from relics)` : ''}${commandOf(s) > TUNING.army.board ? `, at most ${TUNING.army.board}` : ''}`
}

// What a relic adds, a copy, to run-level stat `path` (its `add` mods there: run.monarchHp, run.command), or 0.
const gives = (r, path) => (r.mods ?? []).reduce((n, m) => n + (m.path === path && m.op === 'add' ? m.v : 0), 0)
// The relics that give `path`, a copy each: "Bone Horn +1 (Common)".
const giversOf = (path) => RELIC_LIST.filter((r) => gives(r, path)).map((r) => `${r.name} +${gives(r, path)} (${RELIC_TIERS.find((x) => x.id === r.tier).name})`)
// The relics the run holds that give `path`, a copy each: "Bone Mantle +45, Bone Horn ×2 +2", or null for none.
const heldGivers = (run, path) => {
  const ids = [...new Set(run.state.relics)].filter((id) => gives(relicDef(id), path))
  return ids.length ? ids.map((id) => { const n = relicCount(run.state, id); return `${relicDef(id).name}${n > 1 ? ` ×${n}` : ''} +${n * gives(relicDef(id), path)}` }).join(', ') : null
}

// The Monarch's read-out (DESIGN §2.6): nothing is bought for it. Its HP and Command are its base and its relics',
// every copy in full (run.js monarchHp, commandOf). It holds no relic and has no act: Arise is a soul's skill. Each:
// its name, its icon (dom.js), its value now, a few words on what that gives, and its rule in full for the hover.
export const MONARCH_TEXT = {
  hp: {
    name: 'HP', icon: 'hp', value: (run) => monarchHp(run.state), now: (run) => monarchHp(run.state) > TUNING.monarch.hp ? `${TUNING.monarch.hp} + ${monarchHp(run.state) - TUNING.monarch.hp} relics` : 'max, no HP relics yet',
    rule: (run) => [`Its health: if it runs out, the run ends. ${TUNING.monarch.hp} to begin; only relics raise it, every copy in full, and heal it by as much: ${giversOf('run.monarchHp').join(', ')}.`,
      heldGivers(run, 'run.monarchHp') ? `Yours: ${heldGivers(run, 'run.monarchHp')}.` : 'You hold none yet.',
      unhealed(run.state) ? 'Court of Bone: nothing heals it.' : `Its wounds carry: ${WOUNDS_TEXT}.`]
  },
  command: {
    // Its pieces on the field now, of the most it may field (the value says the Command itself).
    name: 'Command', icon: 'command', value: (run) => commandOf(run.state), now: (run) => `${fielded(souls(run.state.party)).length} of ${fieldCap(run)} on the field`,
    rule: (run) => [`How many pieces it fields (at most ${TUNING.army.board}). ${baseField(run.state)} to begin; only relics raise it, every copy in full: ${giversOf('run.command').join(', ')}. Every Shop stocks one.`,
      heldGivers(run, 'run.command') ? `Yours: ${heldGivers(run, 'run.command')}.` : 'You hold none yet.']
  }
}
// Nothing is bought for the Monarch, in a line.
export const MONARCH_RULE = 'Nothing is bought for the Monarch: its HP and Command grow only by relics.'
// What mends between battles (TUNING.run: postBattleHeal, altarHeal), in words: wounds carry from room to room.
export const WOUNDS_TEXT = `a win heals each piece still standing ${pct(TUNING.run.postBattleHeal)} of its HP; an altar heals ${TUNING.run.altarHeal >= 1 ? 'every piece to full' : `each to ${pct(TUNING.run.altarHeal)} of its HP`}`

// ── reach and Move ───────────────────────────────────────────────────────────────────────────────

// How far its blows reach and whether every one is melee (melee from the ground never touches a flyer) are the sim's
// own (unit.js reachOf, meleeOnly: its tiers' blows counted), so a card never disagrees with the battle.
const moveOf = (u) => Math.round(statsOf(u).move)
// "Reach 4 · ranged · Move 2 · 2×2", a foe met's way too; a foe not met keeps it to itself (the bestiary).
export function reachText (u, foe = false) {
  const d = unitDef(u.id)
  if (d.monarch) return 'Never strikes · never moves'
  const big = sizeOf(u) > 1 && '2×2'
  if (foe && !bestiary.has(u.id)) return ['Reach ?', big, 'its ways unknown until met'].filter(Boolean).join(' · ')
  return [`Reach ${reachOf(u)}`, meleeOnly(u) ? 'melee' : 'ranged', `Move ${moveOf(u)}`, big, foe && BEHAVIOURS[behaviourOf(u)].name].filter(Boolean).join(' · ')
}
// The same in a sentence: yours move, then strike what their blows reach; a foe met comes down its road as far as it
// chooses and strikes what it reaches, and thinks as its way line says (temperLine, from its temperament).
export function reachRule (u, foe = false) {
  const d = unitDef(u.id)
  if (d.monarch) return 'It stands on its seat, never moves and never strikes; the roads run to it. If it falls, the run ends.'
  if (foe && !bestiary.has(u.id)) return 'Not met yet: how far it strikes, how far it comes and how it thinks, you learn by meeting it.'
  const r = reachOf(u)
  const tiles = `${r} tile${r === 1 ? '' : 's'}`
  const melee = meleeOnly(u) && !d.flies ? ' Its blows are melee: they never reach up to a flyer.' : ''
  if (!foe) return `On your turn it moves up to ${moveOf(u)} tiles, then acts: its blows reach ${tiles} from where it stands. Left alone, it strikes with its basic blow, or mends.${melee}`
  const way = d.temper ? ` Its way: ${temperLine(temperOf(u.id)).toLowerCase()}.` : ''
  return `${BEHAVIOURS[behaviourOf(u)].desc} It strikes whatever its blows reach, ${tiles} from where it stands.${melee}${way}`
}

// ── the enemy ────────────────────────────────────────────────────────────────────────────────────

// The enemy as an army: captains with their cohorts (each one more foe of the captain's kind beside it), waves,
// the Sovereign's court. Who comes and where they stand, never what they mean to do.
const SP = TUNING.spawn
const W = SP.waves
// A wave enters as a set turn begins (redesign.md §2.10), W.every turns after the one before (the first wave, the
// formation, on turn 1), and the clock counts from the last one's entry.
export const ENEMY_TEXT = {
  waves: `From floor ${W.floor}: elites (${W.elite} waves), fights from rank ${W.fightRank} (${W.fight}) and sieges (${W.siege}). Each enters at the far edge as its turn begins, ${W.every} turns after the one before.`,
  late: `A floor-1 elite: ${SP.late.n} more foes come over the far edge as turn ${1 + W.every} begins.`,
  entry: `The clock counts ${TUNING.turn.cap} turns from the last wave's entry.`
}
// The turn wave `k` of a room's later waves (node.waves[k]: the second wave is k 0) enters on (turns.js entryTurn).
export const waveTurn = (w, k) => w.when?.turn ?? 1 + (k + 1) * W.every

// A room's foes, every wave's: the formation that stands from the start, then each later wave's.
const roomFoes = (node) => [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat()
// A later wave (node.waves[k]) by name, and when it comes, as the scouts can tell it.
export const waveName = (node, k) => node.waves[k].foes.some((f) => unitDef(f.id).boss) ? `Wave ${k + 2}: the Sovereign` : `Wave ${k + 2}`
export const waveWhen = (w, k = 0) => `${w.foes.length} more as turn ${waveTurn(w, k)} begins.`
// "5 foes", "15 foes in 3 waves".
export function foeCountText (node) {
  const n = node.foes.length
  const later = node.waves ?? []
  const more = later.reduce((m, w) => m + w.foes.length, 0)
  return !later.length ? `${n} foe${n > 1 ? 's' : ''}` : `${n + more} foes in ${later.length + 1} waves`
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
// against you (their Legion); and a status's tick from a blow (`tick`: the status whose tick dealt the last of the
// damage, read off the battle's events: its layer is the killer, but it struck from nowhere, so no tile is told and
// no blow is replayed).
export function deathText (s, battle = null) {
  const d = s.death
  if (!d) return null
  const threat = d.threat && THREATS[d.threat]
  if (d.reason === 'turn-cap') {
    return { head: 'The battle never ended', lines: [`It was still undecided ${TUNING.turn.cap} turns after the last wave entered, and an undecided battle is a defeat.`], threat }
  }
  const m = monarchOf(s)
  const own = d.uid === m?.uid
  const tick = battle?.events.findLast((e) => e.type === 'damage' && e.target === m?.uid && e.hp <= 0)?.status ?? null
  const away = m && m.slot >= 0 && d.from != null ? distance(d.from, deployTile('party', m.slot)) : null
  return {
    head: own ? 'The Monarch fell to a lingering wound'
      : battle?.units.find((u) => u.uid === d.uid)?.shadow ? `Slain by the shadow of your own ${unitDef(d.by).name}, risen against you` : `Slain by ${unitDef(d.by).name}`,
    lines: [
      own ? 'A status ticking on it dealt the last of the damage.'
        : tick ? `With ${statusDef(tick).name}, which it laid on the Monarch: its tick dealt the last of the damage.`
          : `With ${d.ability ? abilityDef(d.ability).name : 'a blow'}${d.ability && abilityDef(d.ability).shape !== 'single' && SHAPE[abilityDef(d.ability).shape] ? `, which hits ${SHAPE[abilityDef(d.ability).shape]}` : ''}.`,
      !own && !tick && d.from != null && `From ${tileText(d.from)}${away != null ? `: ${away} tile${away === 1 ? '' : 's'} from the Monarch` : ''}.`,
      !own && d.wave && waveDeath(s, d.wave)].filter(Boolean),
    threat,
    tick
  }
}

// The killer came in a later wave (d.wave: 1 is the first after the formation): which, from the room's scouting.
function waveDeath (s, k) {
  const w = s.map?.nodes.find((n) => n.id === s.at)?.waves?.[k - 1]
  return w ? `It came with wave ${k + 1}, over the far edge as turn ${waveTurn(w, k - 1)} began.` : `It came with wave ${k + 1}, over the far edge.`
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
// lines at the bottom of the details. realm: where its Arise is read from (realmOf, or a battle's: abilityBlocks),
// and `run`, for its relic's tip. `live`: the one fact the card leads with; without one, the first note's first
// sentence, else its reach. `open`: the details shown whatever Shift says (a panel, not a tooltip).
// Three lines: name and level; the stats (HP, ATK, DEF and Move: no dice, redesign.md §2.16) and a soul's relic slot;
// the live line. The rest waits under Shift or More ▾ (tipDetail), a soul of yours whose kind's tiers bring summons
// saying how many among them (a summon brings none).
export function unitCard (u, { mods = [], stats = null, statuses = null, notes = [], foe = false, realm = null, run = null, live = null, open = false } = {}) {
  const d = unitDef(u.id)
  const st = stats ?? statsOf(u, mods)
  const [shown, maxHp] = hpAt(u, st)
  const summons = !foe && !u.shadow && u.side !== 'foe' ? summonsOf(u) : 0
  // A soul of yours (a run's or a battle's, never a recruit offered or a fusion's preview) has a relic slot.
  const soul = !foe && !u.shadow && u.side !== 'foe' && !d.monarch && u.uid != null
  const stat = (key, label, v) => h('span', { class: 'sx', title: label }, icon(key, 13), h('b', null, v))
  const more = open || tipDetail.on
  // A multiplier on top of the stats, as a chip: ×1.20 dealt, ×0.80 taken.
  const mult = (v, what) => v !== 1 && h('span', { class: 'sx mult' + ((what === 'taken' ? v < 1 : v > 1) ? ' up' : ' down') }, `×${v.toFixed(2)} ${what}`)
  const aura = auraBlock(u)
  const kind = [d.kin && KIN[d.kin].name, d.monarch ? 'you' : ROLES[d.role].name, d.boss && 'Boss'].filter(Boolean).join(' · ')
  const tiers = foe ? [] : tiersOf(u)
  const abs = abilityBlocks(u, st, realm)
  const lead = live ?? (d.monarch ? 'Never strikes; if it falls, the run ends' : firstSentence(notes.find((n) => typeof n === 'string')) ?? reachText(u, foe))
  const mults = [mult(st.damage.dealt, 'dealt'), mult(st.damage.taken, 'taken')].filter(Boolean)
  return h('div', { class: 'card-tip compact' + (foe ? ' foe' : '') + (d.monarch ? ' monarch' : '') + (more ? ' open' : '') },
    h('div', { class: 'ct-name' },
      h('span', { class: 'ct-nm' }, d.name),
      // The Monarch has no level: nothing is bought for it.
      !d.monarch && h('span', { class: 'ct-lv dim' }, `Lv ${u.lvl}`),
      h('span', { class: 'ct-hp' }, hpBar(shown, maxHp), h('span', null, shown <= 0 ? 'fallen' : `${shown}/${maxHp}`))),
    // The stats as icons. The Monarch never strikes nor moves: its ATK and Move would mean nothing.
    h('div', { class: 'ct-stats' },
      !d.monarch && stat('atk', 'ATK', Math.round(st.atk)),
      stat('def', 'DEF', Math.round(st.def)),
      !d.monarch && stat('move', 'Move', Math.round(st.move)),
      soul && relicSlot(u, run)),
    h('div', { class: 'ct-live' },
      h('span', { class: 'ct-lead' }, lead, statuses?.length > 0 && statuses.slice(0, 2).map((x) => [' · ', kw(x.id, statusDef(x.id).name)]), statuses?.length > 2 && ` +${statuses.length - 2}`),
      !open && shiftHint()),
    more && [
      h('div', { class: 'ct-kind dim' }, kind, u.shadow && [' · ', kw(u.summoned ? 'summon' : 'shadow')], sizeOf(u) > 1 && ' · 2×2', d.fused && [' · ', kw('fusion', 'fused')],
        summons > 0 && [' · brings ', kw('summon', `${summons} summon${summons === 1 ? '' : 's'}`), ' each battle']),
      mults.length > 0 && h('div', { class: 'ct-mults' }, mults),
      (abs.length > 0 || aura) && h('div', { class: 'ct-abs' }, abs, aura),
      tiers.length > 0 && h('div', { class: 'ct-tiers' }, tiers.map((t, i) => h('div', { class: 'ct-tier' }, h('b', null, ROMAN[i] ?? i + 1), ' ', t.desc))),
      statuses?.length > 0 && h('div', { class: 'ct-statuses' }, statuses.map((x, i) => [i ? ' · ' : '', statusLine(x)])),
      h('div', { class: 'ct-foot' },
        h('div', { class: 'ct-role' }, h('b', null, reachText(u, foe)), h('span', { class: 'dim' }, ` · ${reachRule(u, foe)}`)),
        d.monarch && h('div', { class: 'warn' }, 'Never strikes; if it falls, the run ends. Only relics raise its HP and Command.'),
        // A foe's lore hints at what its kind does: what it will do is never shown.
        foe && d.flavour && h('div', { class: 'flavour' }, d.flavour),
        notes.filter(Boolean).map((n) => h('div', { class: 'note-line' }, n)))])
}

export const ROMAN = ['I', 'II', 'III', 'IV']

// ── threat ───────────────────────────────────────────────────────────────────────────────────────

// Rough fighting power: √(HP × ATK × damage dealt), wounds included; no rule, skill, place or order is weighed. The
// ratio of the two sides, measured on the old battle (to be measured again in the balance pass): below 0.6 every
// battle won, 0.6–0.8 98%, 0.8–1.0 79%, 1.0–1.2 42%, above 1.2 19%.
// A soul whose kind's tiers bring summons (`summons`: unit.js summonsOf) adds each one's power: a whole one's at
// TUNING.summon.hp of its HP, so √(that share) of a whole one's.
function power (u, mods, summons = 0) {
  const s = statsOf(u, mods)
  const hpFrac = u.maxHp ? u.hp / u.maxHp : 1
  return (hpFrac + summons * Math.sqrt(TUNING.summon.hp)) * Math.sqrt(Math.max(0, s.hp) * s.atk * s.damage.dealt)
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
  const mine = souls(standing(run)).reduce((n, u) => n + power(u, partyMods(run, u), summonsOf(u)), 0)
  // Waves come one after another, and a side's strength in a melee grows as the square of its numbers, so the waves
  // add as the root of their squared powers.
  const forms = [node.foes, ...(node.waves ?? []).map((w) => w.foes)]
  const mods = roomFoeMods(run, node)
  const waves = forms.map((foes) => foes.reduce((m, f) => m + power(f, mods), 0))
  const theirs = Math.sqrt(waves.reduce((n, p) => n + p * p, 0))
  // Their synergies' rules (in the deep: foeRulesOn), which no stat line shows: named, since the number cannot
  // weigh them; yours are not weighed either.
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
    h('p', { class: 'dim' }, 'HP × ATK: your pieces on the field, not the Monarch. It cannot read where they stand, how they move, or your orders.'))
  return h('div', { class: `threat ${t.cls}`, tip: why },
    h('div', { class: 'threat-head' }, h('span', { class: 'dim' }, 'Threat '), h('b', null, t.label),
      h('span', { class: 'dim' }, ` · ${t.text}`)),
    h('div', { class: 'threat-bar' }, h('span', { class: 'theirs', style: `width:${share * 100}%` })),
    t.rules.length > 0 && h('div', { class: 'warn small', tip: () => 'Their synergies\' rules hold in the deep. They bend the battle in ways no stat shows, so the meter does not weigh them: read it as the low end.' },
      `Not counted: their ${t.rules.join(', ')}.`))
}

// ── rooms ────────────────────────────────────────────────────────────────────────────────────────

const R = TUNING.relic
export const ROOM = {
  start: { name: 'Start', text: 'Where this floor begins.' },
  fight: { name: 'Fight', text: 'A battle: essence, and one of the slain to recruit.' },
  elite: { name: 'Elite', text: 'A tier stronger. Pays essence and a recruit, and a bounty of essence on top.' },
  shop: { name: 'Shop', text: `No battle: ${TUNING.shop.relics} relics for essence, one always a Command relic, and from floor ${R.legendary.fromFloor} one a Legendary. Buy as many as you can pay for; leaving is free.` },
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
const perDeepCohort = every(DEEP.cohort, 'more foe beside every captain')
const perDeep = DEEP.count >= 1 ? `${DEEP.count} more foe${DEEP.count === 1 ? '' : 's'} a wave` : `one more foe a wave every ${+(1 / DEEP.count).toFixed(1)} floors`
export const DEEP_TEXT = {
  descend: 'Slaying the Sovereign clears the run for good; then you may descend into the deep, floor after floor, for as long as the Monarch lasts.',
  growth: `Floor ${TUNING.run.floors}'s camps and foes; each floor deeper, +${TUNING.spawn.levelPerFloor + DEEP.level} levels, +${pct(DEEP.hp)} HP and +${pct(DEEP.atk)} ATK, with ${perDeep} (at most ${COLS * ROWS}), ${perDeepWaves} (up to ${DEEP.maxWaves}) and ${perDeepCohort}. ` +
    `Their synergies' rules hold from floor ${TUNING.run.floors + DEEP.rules}. Each floor ends in a big elite: +${DEEP.final.count} foes, +${DEEP.final.level} level${DEEP.final.level === 1 ? '' : 's'}.`,
  fall: 'A fall in the deep ends the run, but the clear stands.',
  now: (floor) => {
    const d = depthOf(floor)
    const more = Math.floor(d * DEEP.count)
    const waves = Math.floor(d * DEEP.waves)
    const cohort = Math.floor(d * DEEP.cohort)
    const up = d * DEEP.level
    return `Deep ${d}: foes ×${(1 + DEEP.hp * d).toFixed(2)} HP, ×${(1 + DEEP.atk * d).toFixed(2)} ATK${up ? `, +${up} level${up === 1 ? '' : 's'}` : ''}` +
      `${more ? `, +${more} a wave` : ''}${waves ? `, +${waves} wave${waves === 1 ? '' : 's'} a room` : ''}${cohort ? `, +${cohort} beside every captain` : ''}.`
  }
}

// A small read-only formation: front row at the bottom, facing the player's grid, a foe to a cell. `small`: a later
// wave's, in a row of them.
function miniGrid (foes, { small = false } = {}) {
  const at = new Map(foes.map((f) => [f.slot, f]))
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const f = at.get(slotAt(r, c))
      cells.push(h('span', { class: 'mini-cell' + (f ? ' on' : '') }, f && portrait(f.id, small ? 16 : 24)))
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
    node.type === 'altar' && unhealed(run.state) && h('p', { class: 'warn' }, 'Court of Bone: not the Monarch.'),
    depthOf(run.state.floor) > 0 && node.type === 'elite' && node.next.length === 0 && h('p', { class: 'warn' }, `Big elite: +${DEEP.final.count} foes, +${DEEP.final.level} levels. Then floor ${run.state.floor + 1}.`),
    node.foes && [
      h('div', { class: 'rt-body' }, miniGrid(node.foes), h('div', { class: 'rt-info' },
        h('div', { class: 'dim small' }, kinds.join(', ')),
        syns.length > 0 && h('div', { class: 'dim small' }, kw('synergy', 'Synergies'), ': ', syns.map((n, i) => [i ? ' · ' : '', h('b', null, n)])))),
      node.waves && h('div', { class: 'rt-waves' }, node.waves.map((w, k) => h('div', { class: 'rt-wave' },
        h('b', null, waveName(node, k)), miniGrid(w.foes, { small: true }), h('div', { class: 'dim small' }, waveWhen(w, k))))),
      threatMeter(run, node)],
    !(reachable && enter) && h('div', { class: 'rt-foot ' + (reachable && !scout ? 'go' : 'dim') },
      node.id === run.state.at ? 'You are here' : scout ? (reachable ? 'Next, after this battle' : 'Not reachable yet') : reachable ? say('Click to enter', 'Tap it again to enter') : 'Not reachable yet'))
}

// Their synergies, short; `run` given, only where the foes hold their rules (the deep: see
// TUNING.spawn.endless.rules), as the battle does.
export const foeRulesOn = (run) => depthOf(run.state.floor) >= TUNING.spawn.endless.rules
export function foeSynergyLine (foes, run = null) {
  const active = synergyNames(activeSynergies(foes).filter(() => !run || foeRulesOn(run)))
  return h('div', { class: 'dim small' }, active.length ? ['Their synergies: ', active.map((n, i) => [i ? ' · ' : '', h('b', null, n)])] : 'No synergies.')
}

// ── synergies ────────────────────────────────────────────────────────────────────────────────────

// The roles a unit counts as: its own, and those `also(u)` adds (Mimicry's holder, a Warden too: alsoOf).
const rolesOf = (u, also) => [unitDef(u.id).role, ...(also?.(u) ?? []).filter((r) => r !== unitDef(u.id).role)]
// Each synergy's need: { axis, id, n } (one kin or one role, redesign.md §2.12).
const needOf = (syn) => ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => ({ axis, id, n })))[0]

// The synergies by kin and role: each its steps (one rule at 4; should the balance pass split one, a lesser form at 4
// and the full at 8), lowest first.
const LADDERS = Object.values(Object.groupBy(SYNERGIES, (syn) => `${needOf(syn).axis}:${needOf(syn).id}`))
  .map((steps) => {
    const { axis, id } = needOf(steps[0])
    return { axis, id, name: (axis === 'kin' ? KIN : ROLES)[id].name, steps: steps.map((syn) => ({ n: needOf(syn).n, syn })).sort((a, b) => a.n - b.n) }
  })
const ladderOf = (syn) => LADDERS.find((l) => l.steps.some((st) => st.syn === syn))

// A synergy's colour on the board, where its pieces glow in it (DESIGN §2.7), and on its chip: each kin's and role's
// its own hue, eleven spread round the wheel.
const SYN_COLOUR = {
  drake: '#f6935a', vanguard: '#f6cf5a', insect: '#e2f65a', undead: '#9bf65a', warden: '#5af68e', skirmisher: '#5af1f6',
  ranger: '#5ab5f6', construct: '#5a79f6', channeler: '#935af6', fae: '#f15af6', trickster: '#f65aa8'
}

// A synergy's rule by name and what it does: "Legion", "every foe slain rises…" (its desc reads "Name: text").
export const ruleName = (syn) => syn.desc.split(': ')[0]
export const ruleText = (syn) => syn.desc.slice(syn.desc.indexOf(': ') + 2)

// Active synergies, short: of each kin's or role's steps only the top one reached ("Undead 4: Legion").
const synergyNames = (active) => active.filter((syn) => ladderOf(syn).steps.filter((st) => active.includes(st.syn)).at(-1).syn === syn)
  .map((syn) => `${syn.name}: ${ruleName(syn)}`)
// The same as chips for the battle's panel (ui.js battleChrome), live from the battle (turns.js synergiesOf): each
// its name, its rule, and the rule's text on hover. → [{ id, name, rule, text }]
export const synergyLabels = (active) => active.filter((syn) => ladderOf(syn).steps.filter((st) => active.includes(st.syn)).at(-1).syn === syn)
  .map((syn) => ({ id: syn.id, name: syn.name, rule: ruleName(syn), text: ruleText(syn) }))

const countsOf = (units, also = null) => {
  const c = { kin: {}, role: {} }
  for (const u of units) {
    const d = unitDef(u.id)
    if (ROLES[d.role].hidden) continue
    c.kin[d.kin] = (c.kin[d.kin] ?? 0) + 1
    for (const role of rolesOf(u, also)) c.role[role] = (c.role[role] ?? 0) + 1
  }
  return c
}
const counts = (u, axis, id, also) => !ROLES[unitDef(u.id).role].hidden && (axis === 'role' ? rolesOf(u, also).includes(id) : unitDef(u.id)[axis] === id)

// The synergies in effect among `units` (your pieces), as the board glows them: each kin or role whose rule is held,
// with its colour and its pieces' uids. → [{ key, name, colour, uids: Set }]
export function synergyGroups (units, also = null) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, also)
  return LADDERS.filter((l) => (c[l.axis][l.id] ?? 0) >= l.steps[0].n).map((l) => ({
    key: `${l.axis}:${l.id}`, name: synergyNames(l.steps.filter((st) => (c[l.axis][l.id] ?? 0) >= st.n).map((st) => st.syn)).at(-1),
    colour: SYN_COLOUR[l.id], uids: new Set(living.filter((u) => counts(u, l.axis, l.id, also)).map((u) => u.uid))
  }))
}

const COUNT_NOTE = 'Counts your pieces standing on the board (and shadows in battle), never the Monarch.'

// The kins and roles you field as chips: lit (in the synergy's colour) once its rule is held, dim while it is a single
// piece away; the rest fold into one "+N" chip. Each chip's tooltip holds its rule and who counts. `units`: your
// pieces. `also`: the roles a piece counts as besides its own (alsoOf: Mimicry). `focus`, `onFocus(key)`: a lit chip
// pressed lights its pieces on the board (and again, lets them go).
export function synergyTracker (units, also = null, { focus = null, onFocus = null } = {}) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, also)
  const who = (axis, id) => tally(living.filter((u) => counts(u, axis, id, also)).map((u) => unitDef(u.id).name)) || 'none fielded'
  const mimics = (axis, id) => axis === 'role' && living.filter((u) => (also?.(u) ?? []).includes(id) && unitDef(u.id).role !== id)
  const mimicry = (axis, id) => mimics(axis, id)?.length > 0 && h('p', { class: 'dim' }, `Counting as ${ROLES[id].name}s too, by a relic: ${tally(mimics(axis, id).map((u) => unitDef(u.id).name))}.`)
  const ladders = LADDERS.map((l) => ({ l, have: c[l.axis][l.id] ?? 0 })).filter((x) => x.have > 0)
    .map(({ l, have }) => ({ l, have, on: have >= l.steps[0].n, next: l.steps.find((st) => have < st.n), key: `${l.axis}:${l.id}` }))
    .map((x) => ({ ...x, near: !!x.next && x.next.n - x.have === 1 }))
  if (!ladders.length) return h('p', { class: 'dim' }, `None yet: field ${Math.min(...LADDERS.map((l) => l.steps[0].n))} of one kin or role.`)
  const press = (x) => x.on && onFocus ? () => onFocus(x.key) : null
  const ladderTip = ({ l, have, next }) => h('div', { class: 'syn-tip' },
    h('b', null, `${l.name} ${have}`), h('span', { class: 'dim' }, ` · ${who(l.axis, l.id)}`),
    h('ol', { class: 'steps-list' }, l.steps.map(({ n, syn }) => h('li', { class: have >= n ? 'held' : '' },
      h('b', null, n), ' ', h('span', { class: 'tag-rule' }, 'Rule'), ' ', h('b', null, ruleName(syn)), ': ', ruleText(syn)))),
    mimicry(l.axis, l.id),
    h('p', { class: 'dim' }, next ? `${next.n - have} more for ${ruleName(next.syn)}. ` : 'Its rule is held. ', COUNT_NOTE))
  const ladderChip = (x) => h(x.on && onFocus ? 'button' : 'span', {
    class: 'syn chip' + (x.on ? ' on' : '') + (x.near ? ' near' : '') + (!x.next ? ' top' : '') + (focus === x.key ? ' focus' : ''),
    style: x.on ? `--g:${SYN_COLOUR[x.l.id]}` : null, onclick: press(x), tip: () => ladderTip(x)
  }, x.l.name, ' ', h('b', null, x.have),
  h('span', { class: 'syn-steps' }, x.l.steps.map(({ n }) => h('i', { class: (x.have >= n ? 'held' : '') + ' rule' + (x.next?.n === n ? ' next' : '') }, n))))
  const far = ladders.filter((x) => !x.on && !x.near)
  return h('div', { class: 'syns chips' },
    ladders.filter((x) => x.on || x.near).sort((a, b) => b.on - a.on || b.have - a.have).map(ladderChip),
    far.length > 0 && h('span', {
      class: 'syn chip far',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'Further off'), far.map((x) =>
        h('div', { class: 'small' }, `${x.l.name} ${x.have}/${x.next.n}`, h('span', { class: 'dim' }, ` · ${ruleName(x.next.syn)}: ${ruleText(x.next.syn)}`))))
    }, `+${far.length}`))
}

// What one more soul of kind `id` is worth to the run (a recruit offer of a kind already held), read from what it
// holds now: how many of the kind; the synergy rules one more fielded beside your standing pieces would bring; the
// tiers it shares with its kind ("Rimeblade II"); and each fusion its kind is part of, with how many of the kind
// you hold of how many the recipe needs ("1/2 for Rime Drake"). Null for a kind not held.
// → { held, steps, tiers, recipes: [{ name, have, n }], lines (for the card's notes), chips (for its face: { text, up }) }
export function recruitWorth (run, id) {
  const s = run.state
  const held = souls(s.party).filter((u) => u.id === id).length
  if (!held) return null
  const now = souls(standing(run))
  const before = activeSynergies(now, alsoOf)
  const steps = activeSynergies([...now, { id, uid: -1, hp: 1 }], alsoOf).filter((syn) => !before.includes(syn))
    .map((syn) => `${syn.name}: ${ruleName(syn)}`)
  const k = s.kinds[id]
  const tiers = tracksOf(id).flatMap((tr, t) => (k?.tracks[t] > 0 ? [`${tr.name} ${ROMAN[k.tracks[t] - 1]}`] : []))
  const recipes = FUSION_LIST.filter((f) => Object.hasOwn(f.needs, id)).map((f) => ({ name: f.name, have: held, n: f.needs[id] }))
  const part = (r) => `${Math.min(r.have, r.n)}/${r.n} for ${r.name}${r.have < r.n ? ` (${r.have + 1}/${r.n} with it)` : ''}`
  return {
    held, steps, tiers, recipes,
    lines: [`You already hold ${held} of its kind; this one is a piece of its own.`,
      steps.length ? `Fielded beside your standing pieces, it brings ${steps.join(', ')}.` : 'Fielded, it brings no new synergy.',
      tiers.length ? `It shares its kind's tiers: ${tiers.join(', ')}.` : 'Its kind holds no tiers yet.',
      recipes.length > 0 && `Fusion: ${recipes.map(part).join(', ')}.`].filter(Boolean),
    chips: [{ text: `Held ${held}` }, ...steps.map((n) => ({ text: `→ ${n}`, up: true })), tiers.length > 0 && { text: `Shares ${tiers.join(', ')}` },
      ...recipes.map((r) => ({ text: `${Math.min(r.have, r.n)}/${r.n} ${r.name}`, up: r.have < r.n && r.have + 1 >= r.n }))].filter(Boolean)
  }
}

// Names with repeats counted: "Tomb Knight, Grave Ghoul ×3".
const tally = (names) => Object.entries(Object.groupBy(names, (n) => n)).map(([n, xs]) => (xs.length > 1 ? `${n} ×${xs.length}` : n)).join(', ')

// ── relics ─────────────────────────────────────────────────────────────────────────

// The moments a piece relic fires on (TRIGGERS), its holder's own (redesign.md §2.15). `short`: the moment in a few
// words.
export const TRIGGER_TEXT = {
  kill: { name: 'On a kill', short: 'its holder slays a foe' },
  fall: { name: 'On a fall', short: 'its holder falls' },
  wave: { name: 'On a wave', short: 'a wave begins while its holder stands: the opening formation as the battle starts, then each later wave as it enters' },
  blow: { name: 'On a blow', short: 'its holder strikes' },
  struck: { name: 'When struck', short: 'its holder is struck and stands' }
}

// A relic's tier (RELIC_TIERS): { id, name, colour }.
const TIER = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x]))
// Whether a relic works unheld (redesign.md §2.15), as its card says it: Run, or Held (a piece relic).
export const relicKind = (id) => (isRunRelic(id) ? 'Run' : 'Held')
// Where a piece relic is now, with a run: who holds each copy, and how many wait unheld.
const whereHeld = (run, id) => {
  const by = souls(run.state.party).filter((u) => u.relics?.includes(id)).map((u) => unitDef(u.id).name)
  const left = unheld(run.state).filter((x) => x === id).length
  return [by.length && `held by ${tally(by)}`, left && `${left} unheld: give ${left === 1 ? 'it' : 'them'} to a soul on the Field`].filter(Boolean).join('; ')
}
// A relic: its name in its tier's colour and its rule, its tier and its kind (a run relic works unheld, its copies
// adding up; a piece relic only through its holder, a copy a holder), with a run the copies owned and who holds them,
// and for a trigger, the moment it fires on.
export const relicTip = (id, run = null) => {
  const r = relicDef(id)
  const n = run ? relicCount(run.state, id) : 0
  const runRelic = isRunRelic(id)
  return h('div', { class: `syn-tip relic-tip rt-${r.tier}` }, h('b', { class: `c-${r.tier}` }, r.name), ' ', h('span', null, r.desc),
    h('div', { class: 'dim small' }, h('span', { class: `tier-tag rt-${r.tier}` }, TIER[r.tier].name), ' ', h('span', { class: 'kind-tag' }, relicKind(id)),
      runRelic ? ' Works for the whole run, unheld; every copy applies.' : ` Works only through the soul holding it, ${TUNING.relic.perPiece === 1 ? 'one' : TUNING.relic.perPiece} a soul; given and taken back out of battle.`),
    run && h('div', { class: 'small' }, !n ? 'Not owned.' : runRelic ? `Owned${n > 1 ? ` ×${n}` : ''}.` : `Owned${n > 1 ? ` ×${n}` : ''}: ${whereHeld(run, id)}.`),
    r.on && h('div', { class: 'dim small' }, h('span', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), ` fires each time ${TRIGGER_TEXT[r.on].short}.`))
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
  piece: () => `Command sets how many pieces you field (at most ${TUNING.army.board}); the rest of your souls wait in the ossuary. Where you place them is where each battle starts: from there each moves on your turn. A 2×2 piece (a fused kind, or a kind with a Colossus tier) moves as one. Each soul has a relic slot (${TUNING.relic.perPiece} a soul) for a piece relic. The Monarch is a piece too: it stands on the seat the camp marks with a crown, never moves, never strikes and holds no relic.`,
  summon: () => `A tier of a few kinds calls up shadows of the kind itself: at each battle's start, as many as the tiers say rise for every piece of the kind on the field, each on the free tile of the camp nearest that piece, at ${pct(TUNING.summon.hp)} of a whole one's HP, with its level and tiers. A summon takes no orders: it strikes or mends with its basic each turn, counts toward your synergies as any shadow, pays no essence, and is gone after the battle.`,
  road: () => 'Before every battle the board floods out from the Monarch through every open tile: each tile\'s arrow points to its neighbour nearest the Monarch, and every foe on the ground keeps to these arrows. How far it comes each turn, from nothing to its Move, is its own judgement: it weighs what it could deal against what your side could deal to it there (the danger the board shades in prep), and the nearer the clock\'s end, the less it waits. A comrade stopped ahead of it holds it back, and a piece of yours blocks it. Some kinds Fly instead, straight over the walls but never through your pieces. You learn which by meeting them.',
  wave: () => `${ENEMY_TEXT.waves} ${ENEMY_TEXT.entry}`,
  shadow: (run) => `A soul holding an Arise relic raises one foe slain within its reach, the corpse you choose, as a skill; Undead 4 raises every foe slain. A shadow of yours rises on the free tile nearest the Monarch, never where it fell, so the dead never block a road. It takes no orders: each turn it strikes or mends with its basic. Shadows count toward your synergies and are gone after the battle.` +
    (run && run.state.relics.includes('hollow_court') ? ' Those a Hollow Court holder raised that stand at a win pay their essence again.' : ''),
  essence: (run) => `Each foe slain pays ${TUNING.essence.perTier} × its tier, whatever its level, into one purse. It buys tiers, fusions (${TUNING.essence.fuse} × the result's tier), one recruit after a win (${TUNING.essence.recruit} × its tier, more for a higher level) and relics in a Shop, and ${priceScaleText(run)}: what a floor pays is worth less on the next. Nothing is bought for the Monarch, and no level is bought: a kind's level is its tiers'.`,
  tier: (run) => `Two tracks a kind, four tiers each (${TUNING.essence.tier.join(' / ')} essence on floor 1; ${priceScaleText(run)}). The first track you take may reach IV; the other then stops at II. A tier IV is a rule: a new ability, an aura, more reach, or Colossus, which grows every piece of the kind to 2×2 (one that no longer fits where it stands goes to the ossuary). A kind's level is its tiers': ${TUNING.level.base} + ${TUNING.level.perTier} × the tiers it holds on both tracks, rounded down; every soul of it rises with each tier, and a recruit joins at it.`,
  fusion: () => `Out of battle it takes exactly the souls the recipe names, each a whole piece, from the ossuary first, then the field, costs ${TUNING.essence.fuse} essence × the result's tier on floor 1 (× the floor's price scale, as every price), and gives one piece of the fused kind in the ossuary, to be placed. In battle a piece may fuse with the parts standing beside it as its act, and the fused piece stands there. The result joins its kind with its tiers, at its level, never below the highest level of the kinds that went into it; a relic its parts held comes back unheld. Select a piece for the recipes its kind is part of; the Codex's Fusions lists them all.`,
  command: (run) => `${TUNING.party.field} to begin. Nothing is bought for the Monarch: only Command relics raise it, every copy in full (${giversOf('run.command').join(', ')}); the rarer, the cleaner. Every Shop stocks one. The field stops at ${TUNING.army.board} pieces however high it goes.` + (run ? ` Now: ${fieldRule(run)}.` : ''),
  synergy: () => `Each kin and each role has one rule, held while four of your pieces of it stand on the board. A fused piece counts once, with its own kin and role; a relic may make its holder count as another role too. ${COUNT_NOTE}`,
  relic: (run) => `Four tiers: ${RELIC_TIERS.map((x) => x.name).join(', ')}. Only Shops sell them, for essence, deeper floors the rarer; every Shop stocks a Command relic, and from floor ${R.legendary.fromFloor} a Legendary, a rule that rewrites the game. A run relic (its card says Run) touches the run or the whole side and works unheld: Command, the Monarch's HP, prices, essence, Arise's reach; its copies add up with no cap. Every other is a piece relic (Held): it waits unheld until you give it to a soul (tap it in the Relics strip beside the ossuary, then the soul, or the slot in the soul's panel), and works only through its holder, its triggers on its holder's own moments. Give, take back and swap freely out of battle, never in one. A held relic stays with its soul in the ossuary, works only on the field, and comes back unheld when its holder is released or fused away; copies are more holders. Arise is one: its holder learns the skill Arise.` +
    (run && unheld(run.state).length ? ` Unheld now: ${tally(unheld(run.state).map((id) => relicDef(id).name))}.` : ''),
  shop: (run) => `Each relic's price is its tier's (${RELIC_TIERS.map((x) => `${x.name} ${TUNING.shop.price[x.id]}`).join(', ')} on floor 1; ${priceScaleText(run)}). Buy any number while the purse allows; nothing else is sold there, and a relic bought is a tier not bought. A soul may be released there for part of its price.`,
  turn: () => `A round: your turn (each piece moves, then acts, in any order you like), then End Turn: each piece of yours given no act strikes with its basic blow (the foe furthest along its road) or mends with its basic heal, then the foes take their turn, one judgement for the camp, then statuses tick, cooldowns fall and a wave whose turn has come enters. Nothing is rolled: the same board and the same orders give the same battle. The battle is won when no foe stands and none is to come, lost the instant the Monarch falls, and lost when still undecided ${TUNING.turn.cap} turns after the last wave entered.`,
  move: () => 'A piece moves first, then acts, never the other way: where it strikes from is where it stands for the foes\' turn. It steps to any of the eight tiles round it, through your own pieces but never through a foe, never diagonally past a wall\'s corner, and never ends on a held tile; a flyer of yours goes over anything. Undo puts it back, its Move whole again, until it acts. Some tiers and statuses add Move.',
  skill: () => 'Every kind has a basic blow, usable every turn, and a mender a basic heal too; everything else is a skill, Arise among them. A skill used rests the next turn (its cooldown) unless its card says otherwise. The pieces you leave alone, the summons and the shadows act with their basics only: the skills are yours to time.',
  cooldown: () => 'Every skill rests a turn once used: its pip under the piece\'s bars goes dark, and lights again as the turn after next begins. Some statuses and relics hurry it.',
  counter: () => 'A melee blow whose target survives, standing within its own basic blow\'s reach of the striker, is answered at once by that blow, if it is melee, on the striker alone. Ground melee never answers a flyer. One answer a blow; a counter is never answered; a Hexed piece and the Monarch never answer. A blow\'s preview shows the counter it would draw before you commit.'
}

// The glossary: the seventeen words, the foes' ways, then the statuses. { name, entries: [{ name, line, more?, sys? }] }
function glossary (run) {
  // A status wears its colour (content.js `colour`), the pall it lays on the board, as a swatch by its name.
  const entry = (id) => ({ name: KEYWORDS[id].name, sys: KEYWORDS[id].sys, line: KEYWORDS[id].line, more: WORD_MORE[id]?.(run) ?? null, colour: STATUSES[id]?.colour ?? null })
  const group = (g) => Object.keys(KEYWORDS).filter((id) => KEYWORDS[id].group === g).map(entry)
  return ['Words', 'Behaviours', 'Statuses'].map((name) => ({ name, entries: group(name) }))
}

// The synergies (redesign.md §2.12): every kin and role, each its rule at 4 in its board colour; with a run in play,
// how many of it you field now.
function synergiesView (run = null) {
  const c = run ? countsOf(souls(standing(run)), alsoOf) : null
  return h('div', { class: 'help-view synergies' },
    h('p', { class: 'dim' }, `Each kin and each role has one rule, held while four of your pieces of it stand on the board, shadows and summons too, never the Monarch. Its pieces glow in its colour. ${COUNT_NOTE}`),
    h('div', { class: 'codex-list' }, LADDERS.map((l) => {
      const have = c?.[l.axis][l.id] ?? null
      return h('div', { class: 'codex-row', style: `--g:${SYN_COLOUR[l.id]}` },
        h('div', { class: 'codex-row-head' }, h('i', { class: 'st-dot', style: `background:${SYN_COLOUR[l.id]}` }), h('b', null, l.name),
          h('span', { class: 'dim small' }, ` · ${l.axis === 'kin' ? 'kin' : 'role'}`), have !== null && h('span', { class: 'codex-have' + (have >= l.steps[0].n ? ' on' : '') }, `${have}/${l.steps[0].n} fielded`)),
        l.steps.map(({ n, syn }) => h('div', { class: 'small' }, h('b', null, `${n}: `), h('span', { class: 'tag-rule' }, ruleName(syn)), ' ', ruleText(syn))))
    })))
}

// The relics (redesign.md §2.11, §2.15): every one by tier, Legendary first, each its glyph, its kind (Run or Held), its
// rule and the moment a trigger fires on; with a run in play, the copies owned and who holds them.
function relicsView (run = null) {
  return h('div', { class: 'help-view relics-view' },
    h('p', { class: 'dim' }, `Only Shops sell them. A Run relic works for the whole run, unheld, every copy in full. A Held relic (a piece relic) works only through the soul you give it to, ${TUNING.relic.perPiece === 1 ? 'one' : TUNING.relic.perPiece} a soul, out of battle; its triggers are its holder's own.`),
    RELIC_TIERS.slice().reverse().map((t) => h('div', { class: `codex-tier rt-${t.id}` },
      h('span', { class: `tier-tag rt-${t.id}` }, t.name),
      h('div', { class: 'codex-list' }, RELIC_LIST.filter((r) => r.tier === t.id).map((r) => {
        const n = run ? relicCount(run.state, r.id) : 0
        return h('div', { class: 'codex-row' + (n ? ' owned' : ''), tip: () => relicTip(r.id, run) },
          h('div', { class: 'codex-row-head' }, h('span', { class: `rs-relic rt-${r.tier}` }, icon(relicIcon(r.id), 18), r.name), h('span', { class: 'kind-tag' }, relicKind(r.id)),
            r.on && h('span', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), n > 0 && h('span', { class: 'codex-have on' }, `owned${n > 1 ? ` ×${n}` : ''}`)),
          h('div', { class: 'small' }, r.desc))
      })))))
}

// The fusions (DESIGN §2.6): every recipe, public from the start, each with its result's card, its parts and its
// price; with a run in play, how many souls of each part's kind you hold, and whether it can be made now.
function fusionsView (run = null) {
  const held = (kind) => run ? souls(run.state.party).filter((u) => u.id === kind).length : null
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

// The codex, one view at a time behind six tabs: Basics (the primer and what your run holds now), Glossary
// (every word, filtered as you type in the search box over them), Synergies (every rule), Relics (every relic),
// Fusions (every recipe) and Bestiary (the foe kinds met). An entry is
// its word and one line; one with more to its rule is a fold. The search box takes the keys: Esc closes, and H
// or ? close while it is empty (`onClose`: the dialog's; none inside the Codex tab). `run`: the run in play, if
// any.
export function codexView (run = null, { onClose = null } = {}) {
  const s = run?.state
  const none = h('p', { class: 'dim gl-none', hidden: true }, 'Nothing matches.')
  const sections = glossary(run).map((g) => {
    const items = g.entries.map((e) => {
      const row = h('div', { class: 'gl-row' },
        h('b', { class: 'gl-term', style: e.sys ? `--k:var(--c-${e.sys})` : null }, e.colour && h('i', { class: 'st-dot', style: `background:${e.colour}` }), e.name), ' ', h('span', { class: 'gl-line' }, e.line))
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
    type: 'search', class: 'gl-search', placeholder: 'Search: move, fusion, Burning…', 'aria-label': 'Search the rules', spellcheck: 'false',
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
    primer(),
    h('p', { class: 'gestures' }, h('b', null, say('Mouse', 'Touch')), ': ', say('click', 'tap'), ' a piece to select it; drag a soul from the ossuary onto the camp to place it, or onto a piece to swap them (a 2×2 swaps with the one piece under it, never two); ',
      say('click', 'tap'), ' empty ground to go back to the Monarch. A selected piece\'s panel holds its kind\'s upgrades, Fuse and its relic slot; ', say('click', 'tap'), ' a relic in the Relics strip, then a soul, to give it. ', say('Hover', 'Long-press'), ' anything for what it is.'),
    h('p', { class: 'gestures' }, h('b', null, 'In battle'), ': ', say('click', 'tap'), ' a piece of yours, then a lit tile to move it (Undo, or its old tile, puts it back); ', say('click', 'tap'), ' a ringed foe to see the damage and the counter, and again to strike; a skill\'s button first to use it instead (Arise\'s targets are the corpses ringed in green). ',
      h('b', null, 'End Turn'), ' when you are done.'),
    s && h('div', { class: 'gl-run' },
      h('span', null, `The Monarch ${monarchOf(s).hp}/${monarchOf(s).maxHp} HP · Command ${commandOf(s)}${ariseHeld(s) ? ` · Arise: tier ≤ ${ariseOf(s).tier} within ${ariseOf(s).domain} tiles of its holder` : ''}`),
      h('span', null, `Souls ${souls(s.party).length}/${rosterCap(run)} · ${fielded(souls(s.party)).length}/${fieldCap(run)} on the field · ${inOssuary(souls(s.party)).length} in the ossuary`),
      h('span', { class: 'gl-relics' }, kw('relic', 'Relics'), s.relics.length ? relicsByTier(s.relics, ({ id, n }) => h('span', { class: `relic rt-${relicTier(id)}`, tip: () => relicTip(id, run) }, relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))) : ' none'),
      depthOf(s.floor) > 0 && h('span', null, DEEP_TEXT.now(s.floor)),
      unhealed(s) && h('span', { class: 'warn' }, 'Court of Bone: nothing heals the Monarch.')),
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
    fill(tabs, [['basics', 'Basics'], ['glossary', 'Glossary'], ['synergies', 'Synergies'], ['relics', 'Relics'], ['fusions', 'Fusions'], ['bestiary', 'Bestiary']].map(([k, name]) =>
      h('button', { class: 'tab' + (k === id ? ' on' : ''), role: 'tab', 'aria-selected': k === id ? 'true' : 'false', 'data-tab': k, onclick: () => view(k) }, name)))
    fill(body, id === 'basics' ? basics : id === 'glossary' ? gloss : id === 'synergies' ? synergiesView(run) : id === 'relics' ? relicsView(run)
      : id === 'fusions' ? fusionsView(run) : bestiaryView())
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

// The primer (redesign.md §3: what the player may rely on; §2.15–2.16: held relics, no dice).
const primer = () => h('ol', { class: 'primer' },
  h('li', null, 'You are the Monarch. You never strike, and ', h('b', { class: 'warn' }, 'if you fall, the run ends'), '.'),
  h('li', null, 'Place your souls in the camp, then fight ', kw('turn'), ' by turn. ', h('b', null, 'A turn is yours'), ': each ', kw('piece'), ' may ', kw('move'), ', then act once: its basic blow, a ', kw('skill'), ', a heal, or Fuse. A blow shows its damage and the ', kw('counter'), ' it would draw before you commit; a move can be undone until the piece acts.'),
  h('li', null, 'What you leave alone strikes anyway at ', h('b', null, 'End Turn'), ', with its basic blow or heal, never a skill. Every skill rests a turn once used.'),
  h('li', null, 'Foes keep to the ', kw('road', 'roads'), ', the arrows to your seat; some ', kw('fly'), '. How far each comes is its own judgement: you learn each kind by meeting it. Nothing of their coming turn is shown. In prep the shading is what your side could deal there next turn.'),
  h('li', null, `No dice: every blow lands and deals what its preview says; the same board and the same orders give the same battle. The clock is shown: ${TUNING.turn.cap} turns from the last wave, and a battle still undecided is lost. Wounds carry: ${WOUNDS_TEXT}.`),
  h('li', null, 'Spend ', kw('essence'), ' on your kinds\' ', kw('tier', 'tiers'), ' and ', kw('fusion', 'fusions'), ', on a recruit after a win, and in a ', kw('shop'), ' on ', kw('relic', 'relics'), '. A run relic works for the whole run: the Monarch grows only by them, its HP and its ', kw('command'), '. A piece relic works through the soul you give it to, one a soul, out of battle; Arise is one, and its holder raises the slain.'))

// The bestiary: every foe kind, the ones met with their reach and Move (reachText), their way line, generated from
// the kind's temperament (content.js temperLine) so it never says what the kind does not do, and their lore; the rest
// a shade, until met.
function bestiaryView () {
  const met = FOE_KINDS.filter((d) => bestiary.has(d.id))
  return h('div', { class: 'help-view bestiary' },
    h('p', { class: 'dim' }, `Met ${met.length} of ${FOE_KINDS.length}. How far a kind strikes, how far it comes and its way are told once you have fought it, here and on its card.`),
    h('div', { class: 'beasts' }, FOE_KINDS.map((d) => {
      const known = bestiary.has(d.id)
      const u = { id: d.id, lvl: 1 }
      return h('div', { class: 'beast' + (known ? '' : ' unknown') },
        h('span', { class: 'beast-port' }, portrait(d.id, 48)),
        h('div', { class: 'beast-text' },
          h('b', null, known ? d.name : '???'),
          h('div', { class: 'dim small' }, known ? `${KIN[d.kin]?.name ?? ''} ${ROLES[d.role].name} · tier ${d.tier}` : 'Not met yet'),
          known && h('div', { class: 'small' }, reachText(u, true)),
          known && d.temper && h('div', { class: 'small beast-way' }, h('b', null, 'Its way: '), temperLine(temperOf(d.id))),
          known && d.flavour && h('div', { class: 'flavour small' }, d.flavour)))
    })))
}

// How to play as a dialog over any screen (H, ?, the help buttons).
export function helpOverlay (onClose, run = null) {
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal help', role: 'dialog', 'aria-label': 'How to play' }, codexView(run, { onClose })))
  return el
}
