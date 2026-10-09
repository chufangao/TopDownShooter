// Rules text, generated from the content data so it is never out of date: unit stat cards, ability
// and status text, room and threat tooltips, the synergy tracker and How to play.
import { TUNING } from './tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, KIN, ROLES, ROLE_LIST, BEHAVIOURS, SYNERGIES, RELIC_LIST, BONDS, THREATS, ORDERS, GRADES, KEYSTONE_LIST, keystoneDef, TRIGGERS } from './content.js'
import {
  statsOf, activeSynergies, synergyActive, baseStats, COLS, ROWS, slotAt, rangeOf, isAllyShape, activeBonds, CAMP_ROWS, pathDef, abilitiesOf, auraOf,
  tileX, tileY, DEPTH, distance, deployTile, makeUnit, summonsOf, wallTiles, TILES
} from './sim/unit.js'
import {
  foeMods, fielded, souls, monarchOf, domainOf, fieldCap, baseField, monarchCost, monarchPoints, MONARCH_STATS, armyLayout, waits,
  detachmentOf, marshalOf, faltersIn, holds, isMonarch, depthOf, rosterCap, inOssuary, currentNode, domainCentre, promoteLevel
} from './sim/run.js'
import { h, fill, icon, portrait, prefs, say } from './dom.js'
import { KEYWORDS, kw } from './keywords.js'

const pct = (v) => `${Math.round(v * 100)}%`
// Seconds to a tenth, whole ones without the tenth: "0.8 s", "120 s".
const secs = (ticks) => `${+(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`
const ROW_NAMES = ['front', 'middle', 'back']

// Camp rows by name, front first, and what standing in one means once the battle starts.
export const campRowLabel = (r) => (r === 0 ? 'Front' : r === CAMP_ROWS - 1 ? 'Rear' : `Row ${r + 1}`)
export const campRowText = (r) => r === 0
  ? 'Closest to the foes: first to meet them, and in the way of anyone coming into the camp.'
  : `${r} row${r > 1 ? 's' : ''} back from the front: their melee has to find a way through the camp to get here, but your ranged souls may need to walk up to reach them.`

// Gauge filled per tick, and how long a cost takes to fill from empty.
const gaugeRate = (s) => (TUNING.gauge.base + s.spd / TUNING.gauge.spdDivisor) * s.gauge.rate
const fillTime = (s, cost) => secs(cost / gaugeRate(s))

// ── mods: what a unit really fights with ─────────────────────────────────────────────────────────

const relicMods = (relics) => relics.flatMap((id) => relicDef(id).mods ?? [])

// The keystones' mods (Legion's HP), on every unit of yours in battle but the Monarch; and the roles one
// counts as another for your synergies and bonds (Mimicry's alias, or null).
const keystoneMods = (run) => run.state.keystones.flatMap((id) => keystoneDef(id).mods ?? [])
export const aliasOf = (run) => holds(run.state, 'alias') ? Object.assign({}, ...run.state.keystones.map((id) => keystoneDef(id).alias ?? {})) : null

// The mods a fielded soul starts a battle with: relics, keystones plus the field's synergies, which count the
// summons standing beside their souls. A held detachment's souls start off the board, so they (and their
// summons) count only once they enter. The Monarch (`u`) takes none of them: its stats are its points' (battle.js modsFor).
export const partyMods = (run, u = null) => u && isMonarch(u) ? [] : [...relicMods(run.state.relics), ...keystoneMods(run),
  ...activeSynergies([...boardField(run), ...armyOf(run).summons], aliasOf(run)).flatMap((s) => s.mods)]
const livingField = (run) => fielded(run.state.party).filter((u) => u.hp > 0)
// Whether a soul's detachment starts later: it waits behind the camp, off the board, until its start.
export const isHeld = (s, u) => waits(detachmentOf(s, u.uid))
// Whether a detachment takes part in the next battle: a soul of it stands on the field, living. One whose
// souls are all in the ossuary or fallen sits the battle out (battleSetup leaves it out): no square, no arrow.
export const takesPart = (s, d) => fielded(s.party).some((u) => u.hp > 0 && d.members.includes(u.uid))
// The living souls (and the Monarch) standing on the board when the battle begins: held ones wait.
export const boardField = (run) => livingField(run).filter((u) => !isHeld(run.state, u))

// The army as the next battle will stand it, as units the cards and synergies can read: `summons`, every
// soul's summons on the tiles the battle will likely give them (summonLayout); `held`, the souls of the
// detachments that start later (armyLayout), in the order they enter once called, each a copy with `det`, its
// detachment's id (their summons appear beside them as they enter). `s`: a copy of the state with a move made
// (the drag preview reads one), else the run's.
export function armyOf (run, s = run.state) {
  return { summons: summonLayout(s, prepFoes(run)), held: armyLayout(s).held.map((b) => ({ ...s.party.find((u) => u.uid === b.uid), det: b.det })) }
}
// The room's formation in prep (its tiles are taken as the battle begins); none on the map.
const prepFoes = (run) => run.state.phase === 'prep' ? currentNode(run)?.foes ?? [] : []

// Where the battle will likely raise each soul's summons (battle.js summon, entryTile): soul by soul in party
// order, every living soul that starts on the board raises its summons (summonsOf) one by one on the open tile
// nearest it, ahead of it first, then level with it, past the walls, everyone standing and every summon already
// placed. As units: the summon kind at its level, `summoned`, its `summoner`, its `tile` (and `slot`, its camp
// cell, or −1 past the camp), with a uid of its own ('m0', 'm1'…: never a soul's).
export function summonLayout (s, foes = []) {
  const walls = new Set(wallTiles(s.camp))
  const standing = fielded(s.party).filter((u) => u.hp > 0 && !isHeld(s, u))
  const taken = new Set([...standing.map((u) => deployTile('party', u.slot)), ...foes.map((f) => deployTile('foe', f.slot))])
  const near = (from) => {
    let best = -1
    let bestK = Infinity
    for (let t = 0; t < TILES; t++) {
      if (taken.has(t) || walls.has(t)) continue
      const dy = tileY(t) - tileY(from)
      const k = distance(t, from) * 1e4 + (dy > 0 ? 0 : dy === 0 ? 1 : 2) * 1e3 + Math.abs(tileX(t) - tileX(from)) * 100 + t / TILES
      if (k < bestK) { best = t; bestK = k }
    }
    return best
  }
  const out = []
  for (const u of souls(standing)) {
    for (const { id, count, lvl } of summonsOf(u)) {
      for (let k = 0; k < count; k++) {
        const tile = near(deployTile('party', u.slot))
        if (tile < 0) break
        taken.add(tile)
        const slot = tileY(tile) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(tile), tileX(tile)) : -1
        out.push({ ...makeUnit(id, { uid: `m${out.length}`, lvl, slot }), tile, summoned: true, summoner: u.uid, cohortOf: u.uid })
      }
    }
  }
  return out
}
// How many a soul raises each battle, all its summon tiers together.
export const summonCount = (u) => summonsOf(u).reduce((n, x) => n + x.count, 0)

// Foes of a room on the current floor start with the floor's multipliers plus their synergies: those of the
// formation they stand in (`foes`: the room's first by default, or one of its later waves).
export const roomFoeMods = (run, node, foes = node.foes) => [...foeMods(run.state.floor, node.type === 'boss'), ...activeSynergies(foes).flatMap((s) => s.mods)]

// The formation bonds one unit holds among `units` (its side's formation), and what they add; `alias` as
// for activeBonds (your side's, under Mimicry).
export const heldBonds = (units, u, alias = null) => activeBonds(units, { alias }).filter((b) => b.uid === u.uid)
export const bondMods = (units, u, alias = null) => heldBonds(units, u, alias).flatMap((b) => b.bond.mods)
export const bondNotes = (units, u, alias = null) => heldBonds(units, u, alias).map((b) =>
  `◆ ${b.bond.name} with ${unitDef(units.find((x) => x.uid === b.partner).id).name}: ${b.bond.desc.split(': ').at(-1).replace(/\.$/, '')}`)

// ── abilities and statuses ───────────────────────────────────────────────────────────────────────

const SHAPE = {
  single: 'one foe',
  ally: 'the most wounded ally',
  self: 'itself',
  row: 'a foe and everyone level with it, in every lane',
  blast: 'a foe and everyone next to it, wherever they stand thickest',
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
    case 'raise': return ['raises ', h('b', null, e.count), ' dead as ', kw('shadow', 'shadows'), ` (${FALTER})`]
    default: return e.op
  }
}

function reachTag (a) {
  if (a.melee) return h('span', { class: 'tag-melee' }, 'Melee')
  const r = rangeOf(a)
  if (isAllyShape(a.shape) && !Number.isFinite(r)) return null
  return h('span', { class: 'tag-ranged' }, Number.isFinite(r) ? `Range ${r}` : 'Any range')
}

// One ability in one line: name, reach, shape and effects, its cost on the right.
// realm: the Monarch's { domain, will } (realmOf, or a battle's), for Arise's numbers; without one the
// text gives the rule.
export function abilityBlock (id, st, realm = null) {
  const a = abilityDef(id)
  const word = a.shape === 'all_allies' && Number.isFinite(rangeOf(a)) ? `allies ≤${rangeOf(a)}` : a.shape === 'all' && a.range ? `foes ≤${a.range}` : SHAPE_WORD[a.shape]
  return h('div', { class: 'ability' + (a.shape === 'corpse' ? ' arise' : '') },
    h('b', null, a.name), ' ',
    a.shape === 'corpse'
      ? ariseText(realm)
      : [reachTag(a), word && h('span', { class: 'tag-shape' }, word), ' ', a.effects.map((e, i) => [i ? ' · ' : '', effectText(e, st)]),
          a.cond && h('span', { class: 'dim' }, ` · only ${a.cond}`)],
    h('span', { class: 'ab-cost dim' }, `${a.castCost}g · ${fillTime(st, a.castCost)}`))
}

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// The Monarch's reach and Will, as Arise and faltering read them, and what the keystones do to them: Arise's
// cap times `raises` and a `tithe` of the Monarch's max HP a shadow (Blood Tithe), the domain on the front
// (`crown`, Vanguard Crown), and shadows that pay again after a win (`reap`, Hollow Court). A battle's `ks` stands
// in for `raises` and `tithe`.
export const realmOf = (run) => ({
  domain: domainOf(run.state), will: run.state.monarch.will,
  raises: run.state.keystones.reduce((n, id) => n * (keystoneDef(id).raises ?? 1), 1),
  tithe: run.state.keystones.reduce((n, id) => n + (keystoneDef(id).tithe ?? 0), 0),
  crown: holds(run.state, 'crown'),
  reap: holds(run.state, 'reap')
})
// The highest tier Arise raises (TUNING.monarch.raiseTier + Will), and how many it may raise a battle
// (TUNING.monarch.raises × (1 + Will), times Blood Tithe's 2).
const raises = (realm) => (realm ? TUNING.monarch.raiseTier + realm.will : `${TUNING.monarch.raiseTier} + Will`)
const raiseCap = (realm) => (realm ? TUNING.monarch.raises * (1 + realm.will) * (realm.raises ?? realm.ks?.raises ?? 1) : `${TUNING.monarch.raises} × (1 + Will)`)
const titheOf = (realm) => realm?.tithe ?? realm?.ks?.tithe ?? 0
const reach = (realm) => (realm ? `${realm.domain} tiles` : `${TUNING.monarch.domain} + Dominion tiles`)
const FALTER = `×${TUNING.monarch.falter}`

// Arise in one line: what it raises, from how far, how many; the rest of its rule is the glossary's (ARISE_MORE).
function ariseText (realm) {
  return [h('span', { class: 'tag-domain' }, reach(realm)), ` a foe corpse, tier ≤ ${raises(realm)} → `, kw('shadow'), ` at ${pct(TUNING.monarch.raiseHp)} HP · `, h('b', null, raiseCap(realm)), ' a battle',
    realm?.reap && ' · Hollow Court reaps it',
    titheOf(realm) > 0 && h('span', { class: 'warn' }, ` · −${pct(titheOf(realm))} HP each`)]
}
// The rest of Arise's rule, for the glossary.
const ARISE_MORE = `It picks the highest tier, then the nearest, on a tile no one living stands on, and never a boss. A shadow fights with its own abilities, stands past the board's ${TUNING.army.board}, ` +
  `${TUNING.monarch.shadowFalter ? 'always falters' : 'falters outside the domain like a soul'}, joins a Marshal's banner if it rises in that Marshal's domain, and is gone when the battle ends. ` +
  'With no corpse in reach, the Monarch banks its gauge.'

// What sets the field size (souls on the field), as the run has it: "3 + Command", with "+ relics" once a
// relic adds to it, and the board's cap once it reaches it.
const relicField = (run) => run.state.relics.reduce((n, id) => n + (relicDef(id).field ?? 0), 0)
const keystoneField = (run) => run.state.keystones.reduce((n, id) => n + (keystoneDef(id).field ?? 0), 0)
export const fieldRule = (run) => {
  const raw = baseField(run.state) + run.state.monarch.command + relicField(run) + keystoneField(run)
  return `${baseField(run.state)} + Command${relicField(run) ? ' + relics' : ''}${holds(run.state, 'field') ? ' + keystones' : ''}${raw > TUNING.army.board ? `, at most ${TUNING.army.board}` : ''}`
}

// Each Monarch stat by name, and what it gives now (monarchNextText: one more point).
export const MONARCH_TEXT = {
  dominion: { name: 'Dominion', now: (run) => `Domain: ${domainOf(run.state)} tiles` },
  command: { name: 'Command', now: (run) => `Souls on the field: ${fieldCap(run)}` },
  will: { name: 'Will', now: (run) => `Raises ${raiseCap(realmOf(run))}, tier ≤ ${TUNING.monarch.raiseTier + run.state.monarch.will}` + (run.state.monarch.will ? ` · Arise +${pct(TUNING.monarch.willHaste * run.state.monarch.will)}` : '') }
}

export const monarchPointText = (run) =>
  `A point: ${monarchCost(run)} essence (${TUNING.monarch.cost} + ${TUNING.monarch.costPerPoint} per point; ${monarchPoints(run.state)} bought), +${TUNING.monarch.hpPerPoint} max HP` +
  (holds(run.state, 'unhealable') ? ', unhealed (Court of Bone).' : ', healed too.')

// ── the army ─────────────────────────────────────────────────────────────────────────────────────

const A = TUNING.army
// "1 Skeleton", "3 Skeletons".
export const named = (id, n) => `${n} ${unitDef(id).name}${n === 1 ? '' : 's'}`

// Whether a fielded soul or a summon starts the battle faltering: a soul as the battle's first tick reads it
// (faltersIn); a summon past the domain falters unless it stands within its summoner's own, a Marshal's.
export const startsFaltering = (s, u) => {
  if (!u.summoned) return faltersIn(s, u)
  if (distance(u.tile, deployTile('party', domainCentre(s))) <= domainOf(s)) return false
  const lord = s.party.find((x) => x.uid === u.summoner)
  return !(lord && marshalOf(s, lord) && distance(u.tile, deployTile('party', lord.slot)) <= TUNING.ranks.domain)
}

// One sentence each: the tooltips' text. The glossary (GLOSSARY) carries the rest of each rule.
export const ARMY_TEXT = {
  ossuary: (run) => `Your souls not on the field: kept, never fighting. Field and ossuary hold ${run ? rosterCap(run) : TUNING.party.roster} souls together.`,
  summon: `Raised beside its soul each battle at its level; it keeps to it and takes its plan, and falters (${FALTER}) and Hunts if the soul falls. Gone after the battle.`,
  board: `The field holds ${A.board} souls at most; summons and shadows stand past that, and held detachments have places of their own.`
}
// ── ranks ────────────────────────────────────────────────────────────────────────────────────────

const RK = TUNING.ranks
// A rank's insignia, by grade: an icon in dom.js.
export const GRADE_ICON = ['soldier', 'knight', 'marshal']

// What promotion takes, and what each rank removes. "Knight at level 4 · 40 essence".
export const rankNeed = (grade) => `${GRADES[grade + 1].name} at level ${RK.level[grade]} · ${RK.cost[grade]} essence`
export const RANK_TEXT = {
  promote: `A soul with the level is promoted for essence: ${rankNeed(0)}; ${rankNeed(1)}.`,
  knight: `A Knight: tier IV (${TUNING.essence.tier[3]}) or a second path's tier I, not both until Marshal; its summon tier raises ${RK.summons[1]} more; ×${RK.might[1]} damage dealt, ÷${RK.might[1]} taken.`,
  marshal: `A Marshal: tier IV and a second path's I–III; its own ${RK.domain}-tile domain where its banner never falters; its summon tier raises ${RK.summons[2]} more; ×${RK.might[2]} dealt, ÷${RK.might[2]} taken.`,
  second: 'A second path stacks on the first; two that remake one ability or both grant an aura never pair.'
}

// Why path `b` cannot be a second path on top of path `a` (pathsClash): the ability both remake, or the aura.
export function clashText (id, a, b) {
  const pa = pathDef(id, a).tiers
  const swap = pathDef(id, b).tiers.slice(0, SECOND_TIERS).map((t) => t.ability?.replace).find((r) => r && pa.some((t) => t.ability?.replace === r))
  return swap ? `both remake ${abilityDef(swap).name}` : 'both grant an aura, and a soul holds one'
}

// The sim's own camp-side check (run.js): the Marshal whose domain covers a soul (startsFaltering is above).
export { marshalOf }

// ── the enemy ────────────────────────────────────────────────────────────────────────────────────

// The enemy as an army: captains and cohorts, waves, sieges, the Sovereign's court. Rules only: what a
// captain was ordered to do is never told (its kind's flavour hints at it), nor where any foe will go.
const SP = TUNING.spawn
const W = SP.waves
// A share in words: "a third", "half", or a percentage.
const shareText = (f) => (Math.abs(f - 1 / 3) < 1e-9 ? 'a third' : f === 0.5 ? 'half' : pct(f))
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
export const ordinal = (n) => ORDINALS[n - 1] ?? `${n}th`
// How many of the field's dead the Sovereign's Grave Tide raises a cast.
const tide = () => abilityDef('grave_tide').effects.find((e) => e.op === 'raise')?.count ?? 0

// The first floor past the second whose cohorts grow (index into SP.cohort), or -1.
const cohortGrows = SP.cohort.findIndex((n, i) => i > 1 && n !== SP.cohort[1])
export const ENEMY_TEXT = {
  captains: `From floor 2: ${SP.captains.fight} captain${SP.captains.fight === 1 ? '' : 's'} a fight, ${SP.captains.elite} an elite, each leading ${SP.cohort[1]} of its kind${cohortGrows > 0 ? ` (${SP.cohort[cohortGrows]} from floor ${cohortGrows + 1})` : ''}; kill one and its cohort falters (${FALTER}) and hunts.`,
  orders: 'An elite\'s captains march under orders of their own, never shown: their lore hints at them.',
  ordered: 'An elite\'s: it may march under orders its lore hints at.',
  member: `Keeps within a tile of its captain; if the captain falls, it falters (${FALTER}) and hunts.`,
  // Whose cohort a foe is in (`captain`: its unit id).
  of: (captain) => unitDef(captain).boss ? `${unitDef(captain).name}'s court: it crumbles when the Sovereign falls.` : `Of ${unitDef(captain).name}'s cohort.`,
  captain: (n, boss = false) => boss ? `Leads a court of ${n}: kill it and they all crumble.`
    : `Captain of ${n}: kill it and they falter (${FALTER}) and hunt.`,
  late: `A floor-1 elite's late pair: ${SP.late.n} more foes at the far edge at ${secs(SP.late.t)}.`,
  waves: `From floor ${W.floor}: elites (${W.elite} waves), fights from rank ${W.fightRank} (${W.fight}) and sieges (${W.siege}). Each enters at the far edge once the last is down to ${shareText(W.share)}, or after ${secs(W.t)}.`,
  court: () => `Floor ${TUNING.run.floors} ends in a siege whose last wave is the Hollow Sovereign and a court of ${SP.court}; its Grave Tide raises ${tide()} dead for it. Kill it and the court crumbles, paying essence.`,
  entry: 'Entries come one a tick a side, and each restarts the escalation clock, up to a point.'
}

// A room's foes, every wave's: the formation that stands from the start, then each later wave's.
export const roomFoes = (node) => [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat()
// A later wave (node.waves[k]) by name, and when it comes, as the scouts can tell it.
export const waveName = (node, k) => node.waves[k].when.at === 'time' ? 'The late pair'
  : node.waves[k].foes.some((f) => unitDef(f.id).boss) ? `Wave ${k + 2}: the Sovereign` : `Wave ${k + 2}`
export const waveWhen = (w) => w.when.at === 'time'
  ? `${w.foes.length} more at ${secs(w.when.t)}.`
  : `At ${shareText(W.share)} of the last, or ${secs(w.when.t)}.`
// "5 foes", "4 foes, 2 more late", "15 foes in 3 waves".
export function foeCountText (node) {
  const n = node.foes.length
  const later = node.waves ?? []
  const more = later.reduce((m, w) => m + w.foes.length, 0)
  return !later.length ? `${n} foe${n > 1 ? 's' : ''}` : later[0].when.at === 'time' ? `${n} foes, ${more} more late` : `${n + more} foes in ${later.length + 1} waves`
}
// A formation's captains (scouted foes: a member's cohortOf is its captain's slot): captain slot → cohort size.
export const cohortSizes = (foes) => {
  const out = new Map()
  for (const f of foes) if (f.cohortOf != null) out.set(f.cohortOf, (out.get(f.cohortOf) ?? 0) + 1)
  return out
}
export function captainLine (foes) {
  const led = cohortSizes(foes)
  if (!led.size) return null
  return h('div', { class: 'dim small' }, 'Captains: ', [...led].map(([slot, n], i) => [i ? ', ' : '', h('b', null, unitDef(foes.find((f) => f.slot === slot).id).name), ` leads ${n}`]), '.')
}

// Where a board tile lies, in the words the camp editor uses: a camp row and lane, the open ground, or a
// row of their formation.
export function tileText (tile) {
  const y = tileY(tile)
  const lane = `lane ${tileX(tile) + 1}`
  const r = CAMP_ROWS - 1 - y
  if (y < CAMP_ROWS) return `your camp, ${r === 0 ? 'front row' : r === CAMP_ROWS - 1 ? 'rear row' : `row ${r + 1}`}, ${lane}`
  if (y < DEPTH - ROWS) return `the open ground between the lines, ${lane}`
  return `their formation, ${['front', 'middle', 'back'][y - (DEPTH - ROWS)]} row, ${lane}`
}

// ── orders ───────────────────────────────────────────────────────────────────────────────────────

// A detachment's start in words, and as a short tag for the camp and the board: "after 20 s" / "20 s".
export const whenText = (w) => w.at === 'time' ? `after ${secs(w.t)}` : { once: 'at once', struck: 'once the Monarch is struck', wave: 'once more foes enter', falls: 'once one of yours falls' }[w.at]
export const whenTag = (w) => w.at === 'time' ? secs(w.t) : { once: 'at once', struck: 'struck', wave: 'wave', falls: 'falls' }[w.at]
// A plan in words: "Stay, at once", "Move to the open ground, lane 4, once one of yours falls".
export const planText = (p) => `${ORDERS.where[p.where].name}${p.where === 'move' ? ` to ${tileText(p.square)}` : ''}, ${whenText(p.when)}`

// One sentence each, for tooltips; the glossary keeps the full rules (ORDER_MORE).
export const ORDER_TEXT = {
  detachments: `Up to ${A.detachments} detachments, each a colour and a plan (Where, When); a soul's summons take its plan, and a soul in none Hunts at once.`,
  get pick () {
    return say('Shift- or Ctrl-click souls on the field (or press Pick) to pick them, then form or join a detachment.',
      'Tap Pick in Orders, then souls on the field, to pick them; then form or join a detachment.')
  },
  reaction: `Any plan stops to fight what is in reach, then resumes. On Stay within ${TUNING.orders.post} tile of its post it is braced: ×${TUNING.orders.braced} damage taken${TUNING.orders.holdFlank ? ', and no flanker slips past' : ''}.`,
  leash: 'Outside the domain only Hunt is heeded: a soul that falters drops its plan for good, so a Move past the edge is one-way. Marshals keep theirs.',
  held: `A later start waits behind the camp, then enters beside the Monarch fresh (full gauge, Shielded ${secs(TUNING.orders.fresh)}), with ${TUNING.orders.reserve} places of its own.`,
  wave: 'If no more foes enter, a wave start never comes: that detachment sits the battle out.'
}

// The orders' rules in full, for the glossary.
const ORDER_MORE = {
  reaction: 'For every unit on either side, whatever its plan: it strikes what is in reach (or saves its gauge for it); else a melee unit steps in to engage a foe within 2 tiles; ' +
    'else a ranged unit holds while a foe is in its range; else it follows its plan.' + (TUNING.orders.holdFlank ? ' A braced unit holds the line: no foe slips through it or away from beside it.' : ''),
  held: `Held souls take none of the field's ${A.board} places: they have ${TUNING.orders.reserve} of their own. When the start comes, they enter one a tick, their summons appearing beside them. ` +
    `A held soul keeps its camp cell, but takes its bonds where it enters. Shielded: ${statusDef('shield').desc.toLowerCase()}`,
  summon: 'On Stay a summon holds the tile it appeared on when that lies within its leash (else it keeps to its soul); on Move it keeps to its soul on the way.',
  leash: 'Back inside or not, a faltered unit Hunts for the rest of the battle. The camp draws a square past the edge faded. A Marshal never falters, nor its banner within its own domain.'
}

// What felled the Monarch (run.state.death), in words: who, with what, from where, and the threat. `battle`
// (run.battle, the last one) tells a shadow from the living: on their side, one of your own dead risen
// against you (their Legion).
export function deathText (s, battle = null) {
  const d = s.death
  if (!d) return null
  // Its name and line as the glossary tells them (keywords.js corrects a few of the content's).
  const threat = d.threat && THREATS[d.threat] && { name: KEYWORDS[d.threat]?.name ?? THREATS[d.threat].name, desc: KEYWORDS[d.threat]?.line ?? THREATS[d.threat].desc }
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
  return w?.when.at === 'time' ? `The killer came with the late pair, which entered at the far edge ${secs(w.when.t)} into the battle.` : `The Monarch was struck down by the ${ordinal(k + 1)} wave, which entered from the far edge.`
}

export function statusLine (s) {
  const d = statusDef(s.id)
  return h('span', { class: 'status-line' }, kw(s.id, d.name), s.stacks > 1 ? ` ×${s.stacks}` : '',
    h('span', { class: 'dim' }, ` ${s.dur === 'battle' ? 'all battle' : secs(s.dur)}`))
}

// ── unit card ────────────────────────────────────────────────────────────────────────────────────

// A tooltip's details wait under Shift: held down, a unit card opens its abilities, path, bonds and notes
// (main.js re-renders the tooltip as Shift goes down or up).
export const tipDetail = { on: false }
// The hint that points to them, gone once Shift is held.
const shiftHint = () => !tipDetail.on && h('span', { class: 'ct-more' }, h('kbd', null, 'Shift'), ' details')
// A note's first sentence, for a card's one live line.
const firstSentence = (n) => typeof n === 'string' ? n.split(/(?<=[.:;])\s/)[0].replace(/[.:;]$/, '') : null

// u: a run unit, a battle unit or a scouted foe { id, lvl, slot }. opts.mods: the mods it fights with;
// opts.stats overrides them with live battle stats; opts.statuses lists live statuses; opts.notes adds
// lines at the bottom of the details.
// realm: the Monarch's { domain, will } for Arise's numbers (see abilityBlock).
// `ordered`: a foe that may march under an elite captain's orders (its captain, or one of its cohort): its
// role's way of moving is then only its kind's, and the card says so without naming the order.
// `live`: the one fact the card leads with (it falters, it is held, its orders, a shadow's fate…); without
// one, the first note's first sentence, else its kin and role.
// Three lines: name, rank and level; the stats; the live line. The rest (abilities, path, statuses in full,
// the role's way, notes) waits under Shift (tipDetail).
export function unitCard (u, { mods = [], stats = null, statuses = null, notes = [], foe = false, realm = null, ordered = false, live = null } = {}) {
  const d = unitDef(u.id)
  const st = stats ?? statsOf(u, mods)
  const hp = u.hp ?? null
  const maxHp = Math.round(st.hp)
  const shown = hp === null ? maxHp : Math.round(hp / (u.maxHp || 1) * maxHp)
  // A stat as its icon and number (the glossary names the icons); the label stays as the hover title.
  const stat = (key, label, v) => h('span', { class: 'sx', title: label }, icon(key, 13), h('b', null, v))
  const more = tipDetail.on
  // A multiplier on top of the stats, as a chip: ×1.20 dealt, ×0.80 taken, ×1.10 gauge.
  const mult = (v, what) => v !== 1 && h('span', { class: 'sx mult' + ((what === 'taken' ? v < 1 : v > 1) ? ' up' : ' down') }, `×${v.toFixed(2)} ${what}`)
  const next = !foe && !d.monarch && !u.shadow && !u.rank && !u.summoned && u.path !== undefined && u.lvl < TUNING.level.cap && baseStats(u.id, u.lvl + 1)
  const now = baseStats(u.id, u.lvl)
  const path = u.path ? pathDef(u.id, u.path) : null
  const path2 = u.path2 ? pathDef(u.id, u.path2) : null
  // A soul's rank (GRADES): only souls have one, never a foe, the Monarch, a summon or a shadow.
  const grade = !foe && !d.monarch && !u.rank && !u.shadow && !u.summoned && u.grade !== undefined ? u.grade : null
  const aura = auraOf(u)
  // What it is, in one line: kin and role, then whatever sets it apart (the level is on the name line).
  const kind = [d.kin && KIN[d.kin].name, d.monarch ? 'you' : ROLES[d.role].name, d.boss && 'Boss'].filter(Boolean).join(' · ')
  // The path tiers it holds, each a short line (the tiers to come are in the soul's panel).
  const held = (p, n) => p.tiers.slice(0, n).map((t, i) => h('div', { class: 'ct-tier' }, h('b', null, `${p.name} ${ROMAN[i]}`), ' ', t.desc))
  const lead = live ?? (d.monarch ? 'Never strikes; if it falls, the run ends' : firstSentence(notes.find((n) => typeof n === 'string')) ?? kind)
  return h('div', { class: 'card-tip compact' + (foe ? ' foe' : '') + (d.monarch ? ' monarch' : '') + (more ? ' open' : '') },
    // 1: the name, its rank and level, its HP.
    h('div', { class: 'ct-name' },
      h('span', { class: 'ct-nm' }, d.name),
      grade !== null && h('span', { class: `ct-rank g${grade}` }, icon(GRADE_ICON[grade], 12), GRADES[grade].name),
      // The Monarch's level is its points bought: none yet, none shown.
      !(d.monarch && !u.lvl) && h('span', { class: 'ct-lv dim' }, `Lv ${u.lvl}`),
      h('span', { class: 'ct-hp' },
        h('span', { class: 'hpbar' + (shown <= 0 ? ' dead' : shown / maxHp < 0.35 ? ' low' : '') }, h('span', { style: `width:${Math.max(0, Math.min(1, shown / maxHp)) * 100}%` })),
        h('span', null, shown <= 0 ? 'fallen' : `${shown}/${maxHp}`))),
    // 2: the stats as icons. The Monarch never strikes: its attack stats would mean nothing.
    h('div', { class: 'ct-stats' },
      !d.monarch && stat('atk', 'ATK', Math.round(st.atk)),
      stat('def', 'DEF', Math.round(st.def)),
      stat('spd', 'SPD', Math.round(st.spd)),
      !d.monarch && stat('acc', 'ACC', Math.round(st.acc)),
      stat('eva', 'EVA', Math.round(st.eva)),
      !d.monarch && stat('crt', 'CRT', `${Math.round(st.crt)}%`)),
    // 3: the one live fact, its statuses by name, and the way to the rest.
    h('div', { class: 'ct-live' },
      h('span', { class: 'ct-lead' }, lead, statuses?.length > 0 && statuses.slice(0, 2).map((x) => [' · ', kw(x.id, statusDef(x.id).name)]), statuses?.length > 2 && ` +${statuses.length - 2}`),
      shiftHint()),
    more && [
      h('div', { class: 'ct-kind dim' }, kind, u.shadow && [' · ', kw('shadow')], u.rank && ' · Cohort', u.summoned && [' · ', kw('summon')]),
      [mult(st.damage.dealt, 'dealt'), mult(st.damage.taken, 'taken'), mult(st.gauge.rate, 'gauge')].some(Boolean) &&
        h('div', { class: 'ct-mults' }, mult(st.damage.dealt, 'dealt'), mult(st.damage.taken, 'taken'), mult(st.gauge.rate, 'gauge')),
      h('div', { class: 'ct-abs' }, abilitiesOf(u).map((id) => abilityBlock(id, st, realm)),
        aura && h('div', { class: 'ability' }, h('b', null, 'Aura'), ' ', h('span', { class: 'tag-shape' }, `≤${aura.range}`), ' ', aura.desc)),
      (path || path2) && h('div', { class: 'ct-tiers' }, path && held(path, u.tier), path2 && held(path2, u.tier2)),
      statuses?.length > 0 && h('div', { class: 'ct-statuses' }, statuses.map((x, i) => [i ? ' · ' : '', statusLine(x)])),
      h('div', { class: 'ct-foot' },
        behaviourLine(d.role, d.monarch || u.rank || u.summoned ? null : ROLES[d.role].autoRow),
        d.monarch && h('div', { class: 'warn' }, `Never strikes; if it falls, the run ends. Lv = points bought (+${TUNING.monarch.hpPerPoint} HP each); nothing else changes its stats.`),
        u.rank && h('div', { class: 'dim' }, ENEMY_TEXT.member),
        u.summoned && h('div', { class: 'dim' }, ARMY_TEXT.summon),
        foe && ordered && h('div', { class: 'dim' }, ENEMY_TEXT.ordered),
        // A foe's lore is the only hint of what it does about your camp: its orders are never shown.
        foe && d.flavour && h('div', { class: 'flavour' }, d.flavour),
        next && h('div', { class: 'dim' }, `Next level +${next.hp - now.hp} HP, +${(next.atk - now.atk).toFixed(1)} ATK`),
        notes.filter(Boolean).map((n) => h('div', { class: 'note-line' }, n)))])
}

export const ROMAN = ['I', 'II', 'III', 'IV']
// A second path is held to its tiers I–III; tier IV is only ever a first path's.
export const SECOND_TIERS = 3

// A path's tiers, the ones held marked: its first `upto` (all four on a first path, three on a second);
// tier IV is a Knight's or a Marshal's.
export const pathTiers = (path, held = 0, upto = path.tiers.length) => h('ol', { class: 'tiers' }, path.tiers.slice(0, upto).map((t, i) =>
  h('li', { class: i < held ? 'held' : '' }, h('b', null, ROMAN[i]), h('span', null, i === 3 && h('span', { class: 'tier-iv' }, 'Knight · Marshal'), t.desc))))

// How a role walks and whom it strikes, in a line (BEHAVIOURS' rules are in the glossary); `row`, the camp
// row it is placed in by default.
function behaviourLine (role, row = null) {
  const r = ROLES[role]
  const b = BEHAVIOURS[r.move]
  return h('div', { class: 'ct-role' }, h('b', null, b.name),
    h('span', { class: 'dim' }, r.move === 'stand' ? ' · never steps' : ` · strikes the ${r.target === 'weakest' ? 'lowest HP%' : 'nearest'}${row !== null ? ` · ${ROW_NAMES[row]} row` : ''}`))
}

// ── threat ───────────────────────────────────────────────────────────────────────────────────────

// Rough fighting power: √(HP × ATK × damage dealt × gauge rate), wounds included; a soul outside the
// Monarch's domain (and its Marshal's) counts at its faltering damage, so the meter answers where the Monarch stands. The
// ratio of the two sides tracks the basic autoplayer's win rate with the Monarch (200 seeded runs):
// below 0.6 every battle won, 0.6–0.8 98%, 0.8–1.0 79%, 1.0–1.2 42%, above 1.2 19%. That was measured
// before summons; the summons on the board now count too (held detachments do not), like souls.
function power (u, mods) {
  const s = statsOf(u, mods)
  const hpFrac = u.maxHp ? u.hp / u.maxHp : 1
  return Math.sqrt(Math.max(0, s.hp * hpFrac) * s.atk * s.damage.dealt * gaugeRate(s))
}
const FALTERS = [{ path: 'damage.dealt', op: 'mul', v: TUNING.monarch.falter }]

const THREAT = [
  { below: 0.6, label: 'Low', cls: 't-low', text: 'Should be an easy win.' },
  { below: 0.8, label: 'Moderate', cls: 't-mod', text: 'Very likely a win.' },
  { below: 1.0, label: 'High', cls: 't-high', text: 'Usually a win, with losses.' },
  { below: 1.2, label: 'Severe', cls: 't-sev', text: 'Close to a coin flip.' },
  { below: Infinity, label: 'Deadly', cls: 't-dead', text: 'Usually a loss.' }
]
// Nothing of yours on the board can strike (every soul in the ossuary or fallen): no ratio to read, and no win.
const UNFIELDED = { label: 'Deadly', cls: 't-dead', text: 'Nothing of yours on the field can strike, and the Monarch alone cannot win.' }

export function threat (run, node) {
  // The Monarch never strikes: only the souls and their summons on the board count, at their faltering
  // damage outside its domain.
  const mods = partyMods(run)
  const mine = [...souls(boardField(run)), ...armyOf(run).summons].reduce((n, u) => n + power(u, startsFaltering(run.state, u) ? [...mods, ...FALTERS] : mods), 0)
  // Each wave with its own formation's synergies. Waves come one after another, not all at once, and a side's
  // strength in a melee grows as the square of its numbers (Lanchester's square law), so the waves add as the
  // root of their squared powers: one wave counts in full, two equal waves as √2 of one, not 2. (A wave that
  // breaks in early overlaps the one before it; the bands below were measured for a single wave.)
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
  // The two powers behind the reading are in its tooltip: the word and the bar are what a glance needs.
  const why = () => h('div', { class: 'syn-tip' }, h('b', null, `Threat: ${t.label}`), ' ', h('span', { class: 'num foe' }, Math.round(t.theirs)), ' vs ', h('span', { class: 'num' }, Math.round(t.mine)),
    t.waves.length > 1 && h('span', { class: 'dim' }, ` (waves ${t.waves.map(Math.round).join(' + ')}, as √Σ²)`),
    h('p', { class: 'dim' }, `HP × ATK × speed. Yours: souls and summons on the board, ×${TUNING.monarch.falter} if they `, kw('falter'), '; not held ones or the Monarch.'))
  return h('div', { class: `threat ${t.cls}`, tip: why },
    h('div', { class: 'threat-head' }, h('span', { class: 'dim' }, 'Threat '), h('b', null, t.label),
      h('span', { class: 'dim' }, ` · ${t.text}`)),
    h('div', { class: 'threat-bar' }, h('span', { class: 'theirs', style: `width:${share * 100}%` })),
    t.rules.length > 0 && h('div', { class: 'warn small', tip: () => 'Their 8-step rules hold in the deep. They bend the battle in ways no stat shows, so the meter does not weigh them: read it as the low end.' },
      `Not counted: their ${t.rules.join(', ')}.`))
}

// ── rooms ────────────────────────────────────────────────────────────────────────────────────────

export const ROOM = {
  start: { name: 'Start', text: 'Where this floor begins.' },
  fight: { name: 'Fight', text: 'A battle: essence, and one of the slain to recruit.' },
  elite: { name: 'Elite', text: `A tier stronger. Pays essence and a recruit, plus a relic (1 of ${TUNING.essence.eliteRelics}) and a keystone from floor ${TUNING.keystone.fromFloor}.` },
  reliquary: { name: 'Reliquary', text: `No battle: take 1 of 3 relics (at most ${TUNING.essence.relicMax}).` },
  rite: { name: 'Rite', text: `No battle: take 1 of 3 path tiers free, and a keystone from floor ${TUNING.keystone.fromFloor}.` },
  altar: { name: 'Altar', text: `No battle: all heal to full; the fallen rise (souls at ${pct(TUNING.run.altarRevive)} HP).` },
  boss: { name: 'The Hollow Sovereign', text: `A siege: ${W.siege - 1} waves, then the Sovereign and its court. Kill it to clear the run.` },
  siege: { name: 'Siege', text: `${W.siege} waves, no prep between; essence paid with the win.` }
}
// The rest of each room's rule, for the glossary.
const ROOM_MORE = {
  elite: `On floor 1 a late pair joins it at ${secs(SP.late.t)}; from floor ${W.floor} it comes in ${W.elite} waves. Past ${TUNING.essence.relicMax} relics, elites and reliquaries offer none.`,
  boss: 'It grows stronger at 60% and 25% HP, and raises the dead. Slay it and the court crumbles: the run is cleared, and you may descend into the deep.',
  siege: `Each wave enters at the far edge when the one before is down to ${shareText(W.share)}, or after ${secs(W.t)}. Each wave's essence is tallied as it falls.`,
  altar: 'Under Court of Bone the Monarch is not healed.'
}

// ── the deep ─────────────────────────────────────────────────────────────────────────────────────

// The endless floors past the Sovereign's (TUNING.spawn.endless), in words: what descending means, how each
// floor deeper grows, and where a given floor stands.
const DEEP = TUNING.spawn.endless
const every = (k, what) => k >= 1 ? `${k} ${what} every floor deeper` : `one ${what} every ${+(1 / k).toFixed(1)} floors`
const perDeepWaves = every(DEEP.waves, 'more wave to every room')
const perDeepCohort = every(DEEP.cohort, 'more foe behind every captain')
const perDeep = DEEP.count >= 1 ? `${DEEP.count} more foe${DEEP.count === 1 ? '' : 's'} a wave` : `one more foe a wave every ${+(1 / DEEP.count).toFixed(1)} floors`
export const DEEP_TEXT = {
  descend: `Slaying the Sovereign clears the run for good; then you may descend into the deep, floor after floor, for as long as the Monarch lasts.`,
  growth: `Floor ${TUNING.run.floors}'s camps and foes; each floor deeper, +${TUNING.spawn.levelPerFloor + DEEP.level} levels, +${pct(DEEP.hp)} HP and +${pct(DEEP.atk)} ATK, with ${perDeep} (at most ${COLS * ROWS}), ${perDeepWaves} (up to ${DEEP.maxWaves}) and ${perDeepCohort}. ` +
    `Their 8-step rules hold from floor ${TUNING.run.floors + DEEP.rules}. Each floor ends in a big elite: +${DEEP.final.count} foes, +${DEEP.final.level} level${DEEP.final.level === 1 ? '' : 's'}.`,
  fall: 'A fall in the deep ends the run, but the clear stands.',
  // Where floor `floor` stands, for the top bar and the end screen.
  now: (floor) => {
    const d = depthOf(floor)
    const more = Math.floor(d * DEEP.count)
    const waves = Math.floor(d * DEEP.waves)
    const cohort = Math.floor(d * DEEP.cohort)
    const up = d * DEEP.level
    return `Deep ${d}: foes ×${(1 + DEEP.hp * d).toFixed(2)} HP, ×${(1 + DEEP.atk * d).toFixed(2)} ATK${up ? `, +${up} level${up === 1 ? '' : 's'}` : ''}` +
      `${more ? `, +${more} a wave` : ''}${waves ? `, +${waves} wave${waves === 1 ? '' : 's'} a room` : ''}${cohort ? `, +${cohort} a cohort` : ''}.`
  }
}

// A small read-only formation: front row at the bottom, facing the player's grid. A captain carries a flag
// with its cohort's size, its members a dashed edge. `small`: a later wave's, in a row of them.
export function miniGrid (foes, { small = false } = {}) {
  const at = new Map(foes.map((f) => [f.slot, f]))
  const led = cohortSizes(foes)
  const rows = []
  for (let r = ROWS - 1; r >= 0; r--) {
    const cells = []
    for (let c = 0; c < COLS; c++) {
      const f = at.get(slotAt(r, c))
      cells.push(h('span', { class: 'mini-cell' + (f ? ' on' : '') + (f && led.has(f.slot) ? ' cap' : '') + (f?.cohortOf != null ? ' mem' : '') },
        f && portrait(f.id, small ? 16 : 24), f && led.has(f.slot) && h('i', { class: 'mini-flag' }, led.get(f.slot))))
    }
    rows.push(h('div', { class: 'mini-row' }, cells))
  }
  return h('div', { class: 'mini-grid' + (small ? ' small' : '') }, rows, !small && h('div', { class: 'mini-label dim' }, 'front row ↓'))
}

// `enter`: an Enter ▸ button stands under it (a room chosen by touch), so its foot says nothing more.
export function roomTip (run, node, { reachable, enter = false }) {
  const r = ROOM[node.type]
  const kinds = node.foes && [...new Set(roomFoes(node).map((f) => unitDef(f.id).name))]
  // Pictures first: the formation; then its numbers in a line; words only for what a picture cannot say.
  const syns = node.foes && synergyNames(activeSynergies(node.foes).filter((syn) => !syn.rule || foeRulesOn(run)))
  return h('div', { class: 'room-tip compact' },
    h('div', { class: `rt-head t-${node.type}` }, icon(node.type === 'boss' ? 'boss' : node.type, 20), h('b', null, r.name),
      node.foes && h('span', { class: 'rt-count' }, `${foeCountText(node)} · Lv ${node.foes[0].lvl}`)),
    h('p', { class: 'rt-text' }, r.text),
    node.type === 'altar' && holds(run.state, 'unhealable') && h('p', { class: 'warn' }, 'Court of Bone: not the Monarch.'),
    node.type === 'reliquary' && run.state.relics.length >= TUNING.essence.relicMax && h('p', { class: 'warn' }, `You already hold ${TUNING.essence.relicMax} relics, the most you can: it will offer nothing, and entering uses it up.`),
    depthOf(run.state.floor) > 0 && node.type === 'elite' && node.next.length === 0 && h('p', { class: 'warn' }, `Big elite: +${DEEP.final.count} foes, +${DEEP.final.level} levels. Then floor ${run.state.floor + 1}.`),
    // The formation's picture, who stands in it beside it.
    node.foes && [
      h('div', { class: 'rt-body' }, miniGrid(node.foes), h('div', { class: 'rt-info' },
        h('div', { class: 'dim small' }, kinds.join(', ')),
        captainLine(node.foes),
        syns.length > 0 && h('div', { class: 'dim small' }, kw('synergy', 'Synergies'), ': ', syns.map((n, i) => [i ? ' · ' : '', h('b', null, n)])))),
      // The waves to come, scouted like the first: who, where they stand, and when they come; never what they do.
      node.waves && h('div', { class: 'rt-waves' }, node.waves.map((w, k) => h('div', { class: 'rt-wave' },
        h('b', null, waveName(node, k)), miniGrid(w.foes, { small: true }), h('div', { class: 'dim small' }, waveWhen(w))))),
      threatMeter(run, node)],
    !(reachable && enter) && h('div', { class: 'rt-foot ' + (reachable ? 'go' : 'dim') }, reachable ? say('Click to enter', 'Tap it again to enter') : node.id === run.state.at ? 'You are here' : 'Not reachable yet'))
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
// steps stack and whose top step is a rule (`rule`: no number, it changes what happens in battle); and the
// pacts, which need a kin and a role at once.
const LADDERS = Object.values(Object.groupBy(SYNERGIES.filter((syn) => needsOf(syn).length === 1), (syn) => `${needsOf(syn)[0].axis}:${needsOf(syn)[0].id}`))
  .map((steps) => {
    const { axis, id } = needsOf(steps[0])[0]
    return { axis, id, name: (axis === 'kin' ? KIN : ROLES)[id].name, steps: steps.map((syn) => ({ n: needsOf(syn)[0].n, syn })).sort((a, b) => a.n - b.n) }
  })
const PACTS = SYNERGIES.filter((syn) => needsOf(syn).length > 1)
const ladderOf = (syn) => LADDERS.find((l) => l.steps.some((st) => st.syn === syn))

// A rule step's name and what it does: "The Legion", "every foe slain rises…" (its desc reads "Name: text").
export const ruleName = (syn) => syn.desc.split(': ')[0]
const ruleText = (syn) => syn.desc.slice(syn.desc.indexOf(': ') + 2)
// A clause as a sentence of its own (after a full stop): its first letter capitalised.
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1)
const ruleTag = () => h('span', { class: 'tag-rule' }, 'Rule')

// Active synergies, short: of each ladder only its top step reached ("Undead 6", "Undead 8: The Legion"),
// then the pacts.
export const synergyNames = (active) => active.filter((syn) => {
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

const needText = (syn, c) => needsOf(syn).map(({ axis, id, n }) => ({ name: (axis === 'kin' ? KIN : ROLES)[id].name, have: c[axis][id] ?? 0, n, axis, id }))

const COUNT_NOTE = 'Counts standing souls and their summons on the board (and shadows in battle), never the Monarch.'

// The kins and roles you field as chips: lit once a step is reached, dim while the next step is a single unit
// away; the rest fold into one "+N" chip. Each chip's tooltip holds its whole step ladder and who counts.
// Pacts (a kin and a role at once) the same. `units`: the field and the summons. `alias`: your side's under
// Mimicry (aliasOf).
export function synergyTracker (units, alias = null) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, alias)
  const counts = (u, axis, id) => !ROLES[unitDef(u.id).role].hidden && (axis === 'role' ? rolesOf(unitDef(u.id), alias).includes(id) : unitDef(u.id)[axis] === id)
  const who = (axis, id) => tally(living.filter((u) => counts(u, axis, id)).map((u) => unitDef(u.id).name)) || 'none fielded'
  const mimicry = (axis, id) => alias && axis === 'role' && Object.values(alias).includes(id) && h('p', { class: 'dim' }, `Mimicry: ${Object.entries(alias).map(([a, b]) => `${ROLES[a].name}s count as ${ROLES[b].name}s`).join(', ')} too.`)
  const ladders = LADDERS.map((l) => ({ l, have: c[l.axis][l.id] ?? 0 })).filter((x) => x.have > 0)
    .map(({ l, have }) => ({ l, have, on: have >= l.steps[0].n, next: l.steps.find((st) => have < st.n) }))
    .map((x) => ({ ...x, near: !!x.next && x.next.n - x.have === 1 }))
  const pacts = PACTS.map((syn) => ({ syn, needs: needText(syn, c), on: synergyActive(syn, c) }))
    .filter((x) => x.on || x.needs.every((n) => n.have > 0))
    .map((x) => ({ ...x, near: !x.on && x.needs.reduce((k, n) => k + Math.max(0, n.n - n.have), 0) === 1 }))
  if (!ladders.length && !pacts.length) return h('p', { class: 'dim' }, 'None yet: field 2 of one kin or role.')
  const ladderTip = ({ l, have, next }) => h('div', { class: 'syn-tip' },
    h('b', null, `${l.name} ${have}`), h('span', { class: 'dim' }, ` · ${who(l.axis, l.id)}`),
    h('ol', { class: 'steps-list' }, l.steps.map(({ n, syn }) => h('li', { class: have >= n ? 'held' : '' },
      h('b', null, n), ' ', syn.rule ? [ruleTag(), ' ', h('b', null, ruleName(syn)), ': ', ruleText(syn)] : syn.desc.replace(`${l.name} ${n}: `, '')))),
    h('p', { class: 'dim' }, next ? `${next.n - have} more for ${next.syn.name}. ` : 'Every step reached. ', 'Steps stack. ', COUNT_NOTE))
  const ladderChip = (x) => h('span', {
    class: 'syn chip' + (x.on ? ' on' : '') + (x.near ? ' near' : '') + (!x.next ? ' top' : ''),
    tip: () => ladderTip(x)
  }, x.l.name, ' ', h('b', null, x.have),
  h('span', { class: 'syn-steps' }, x.l.steps.map(({ n, syn }) => h('i', { class: (x.have >= n ? 'held' : '') + (syn.rule ? ' rule' : '') + (x.next?.n === n ? ' next' : '') }, n))))
  const pactTip = ({ syn, needs, on }) => h('div', { class: 'syn-tip' },
    h('b', null, syn.name), ' ', h('span', null, syn.desc.split(': ').at(-1)),
    needs.map((n) => h('div', { class: 'small' }, `${n.name} ${n.have}/${n.n} `, h('span', { class: 'dim' }, who(n.axis, n.id)))),
    needs.map((n) => mimicry(n.axis, n.id)).find(Boolean),
    !on && h('p', { class: 'dim' }, COUNT_NOTE))
  const pactChip = (x) => h('span', { class: 'syn chip pact' + (x.on ? ' on' : '') + (x.near ? ' near' : ''), tip: () => pactTip(x) },
    x.syn.name, ' ', h('b', null, x.needs.map((n) => `${Math.min(n.have, n.n)}/${n.n}`).join('+')))
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

// Active formation bonds, each with who holds it and with whom; the same bond between the same kinds (two
// pairs of Tomb Knights, say) is listed once, with how many hold it.
export function bondTracker (units, alias = null) {
  const held = activeBonds(units.filter((u) => u.hp > 0), { alias })
  const name = (uid) => unitDef(units.find((u) => u.uid === uid).id).name
  if (!held.length) return h('p', { class: 'dim' }, 'None: a soul bonds with who stands beside, behind or ahead of it.')
  // One chip a bond, with how many hold it; who holds it with whom is its tooltip.
  const rows = Object.values(Object.groupBy(held, (b) => b.bond.id))
  return h('div', { class: 'syns chips' }, rows.map((bs) => {
    const b = bs[0]
    const pairs = tally(bs.map((x) => `${name(x.uid)} · ${name(x.partner)}`))
    return h('span', {
      class: 'syn chip bond on',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, b.bond.name), ' ', h('span', null, b.bond.desc),
        h('p', { class: 'dim small' }, pairs))
    }, '◆ ', b.bond.name, bs.length > 1 && h('b', null, ` ×${bs.length}`))
  }))
}

// ── relics ────────────────────────────────────────────────────────────────────────────

// The moments a trigger relic fires on (TRIGGERS), for your side only, and what each counts.
// `short`: the moment in a few words, for a tooltip; `when`: in full, for the glossary.
export const TRIGGER_TEXT = {
  kill: { name: 'On a kill', short: 'one of yours lands a killing blow', when: 'one of yours (a soul, a summon or a shadow) slays a foe. "The killer" is the one that struck the last blow.' },
  fall: { name: 'On a fall', short: 'one of yours falls (never the Monarch)', when: 'one of yours falls: a soul, a summon or a shadow, never the Monarch, whose fall ends the battle. A soul that rises by Undying still fell.' },
  enter: { name: 'On entry', short: 'a held soul of yours enters from behind the camp', when: 'a soul of a detachment held back for a later start enters the board from behind the camp. Its summons appearing with it, and a shadow rising by Arise, are no entry.' },
  struck: { name: 'When struck', short: 'the Monarch takes damage and stands', when: 'the Monarch takes damage, a blow or a status ticking on it, and still stands. Blood Tithe\'s cost is not a blow.' }
}

// A relic: its name and rule, and for a trigger, the moment it fires on. It lasts the run (the Relic keyword).
export const relicTip = (id) => {
  const r = relicDef(id)
  return h('div', { class: 'syn-tip relic-tip' }, h('b', { class: 'c-relic' }, r.name), ' ', h('span', null, r.desc),
    r.on && h('div', { class: 'dim small' }, h('span', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), ` fires each time ${TRIGGER_TEXT[r.on].short}.`))
}

// ── keystones ────────────────────────────────────────────────────────────────────────────────────

// What each keystone's rule covers beyond its one line (KEYSTONE_LIST holds the rule itself).
const KEYSTONE_MORE = {
  legion: `Your souls, their summons and your shadows fight at ${pct(keystoneDef('legion').mods[0].v)} of their max HP in battle; the Monarch keeps all of its own. The field takes ${keystoneDef('legion').field} more souls (still at most the board's ${TUNING.army.board}).`,
  undying: 'A soul on the field (never a summon, a shadow or the Monarch) that falls rises at once on its own tile, its summons still with it. Its second fall in a battle is final. Its first still counts as a fall: a detachment held for one falling is called, and relics that fire when one of yours falls fire. Nothing ever revives the Monarch.',
  one_army: 'A soul pools its HP with its summons (and, for a Marshal, the shadows that join it) as the battle begins. A blow to any of them comes out of the pool, shared so each stands at the same share of its max HP: they fall together. Heals go into the pool, and a summon or shadow joining joins it.',
  mimicry: 'A Vanguard keeps its own role and counts as a Warden as well, for your synergies and your formation bonds. Your foes never mimic.',
  vanguard_crown: 'Faltering and Arise\'s reach measure from the soul nearest the foes (then the middle lane), and the domain moves with the front as it advances or falls. Held detachments enter beside that soul, not the Monarch. With no soul standing it falls back on the Monarch.',
  hollow_court: 'Each shadow Arise raised that still stands when a battle is won pays the essence its foe paid, again. Fallen shadows pay nothing, and every shadow is gone after the battle. It reaps nothing of a battle fought before you took it.',
  blood_tithe: `The tier limit is unchanged (${TUNING.monarch.raiseTier} + Will). The Monarch raises no shadow while its HP is at or below the cost, so the tithe never fells it, and the cost is not a blow.`,
  court_of_bone: 'Nothing heals the Monarch: not healers, Regen, relics, the rest after a win, altars or a Monarch point (which still adds max HP). Your healers turn to others.'
}

export const keystoneTip = (id, run = null) => {
  const k = keystoneDef(id)
  const held = run?.state.keystones ?? []
  // The rule in a line, and how many are held; the fine print (KEYSTONE_MORE) is the glossary's.
  return h('div', { class: 'syn-tip ks-tip' }, h('b', { class: 'c-keystone' }, k.name), ' ', h('span', null, k.desc),
    h('div', { class: 'dim small' }, h('span', { class: 'ks-tag' }, 'Keystone'), ` ${held.includes(id) ? 'held' : run ? 'not held' : ''}${run ? ` · ${held.length}/${TUNING.keystone.max}` : ` · at most ${TUNING.keystone.max}`} · details in How to play (H)`))
}


// ── how to play ──────────────────────────────────────────────────────────────────────────────────

// What each keyword's rule says beyond its one line, for the glossary's "more"; `run`, when one is in play,
// adds where it stands now.
const KW_MORE = {
  monarch: (run) => `It starts with ${TUNING.monarch.hp} HP and stands on the cell you give it, never in the ossuary. A Monarch point costs ${TUNING.monarch.cost} essence, ${TUNING.monarch.costPerPoint} more for each bought, and adds ${TUNING.monarch.hpPerPoint} max HP; ` +
    `no synergy, relic or keystone changes its stats (statuses and auras still reach it). Its wounds carry: it heals ${pct(TUNING.run.postBattleHeal)} after a win, all at an altar. If every soul falls while it stands, the battle goes on.` +
    (run ? ` Now: ${monarchOf(run.state).lvl > 0 ? `level ${monarchOf(run.state).lvl}, ` : ''}${monarchOf(run.state).hp}/${monarchOf(run.state).maxHp} HP.` : ''),
  domain: (run) => `It reaches ${TUNING.monarch.domain} + Dominion tiles in every direction, diagonals counting as one, and can run past the camp onto their ground; the camp outlines it. ` +
    `A Marshal carries one of its own (${RK.domain} tiles) for its banner. ${KEYSTONE_LIST.filter((k) => k.domain).map((k) => `${k.name}${k.crown ? ' centres it on your front-most captain and' : ''} ${k.domain > 0 ? 'widens' : 'shrinks'} it by ${Math.abs(k.domain)}`).join('; ')}.` + (run ? ` Now: ${domainOf(run.state)} tiles.` : ''),
  falter: () => `${ORDER_MORE.leash} A shadow ${TUNING.monarch.shadowFalter ? 'always falters' : 'falters outside the domain like a soul'}, and a summon whose soul fell falters wherever it stands.`,
  approach: () => 'A cell\'s open neighbours are its approach tiles: walls, and anyone of yours standing there, close them.',
  arise: () => `A cast of ${abilityDef('arise').castCost} gauge; at most ${TUNING.monarch.raises} × (1 + Will) a battle (twice that under Blood Tithe), of tier ≤ ${TUNING.monarch.raiseTier} + Will. ${ARISE_MORE}`,
  shadow: () => 'Shadows count toward your synergies while they stand, and are gone after the battle. Under Hollow Court, those standing at a win pay their essence again.',
  command: (run) => `${TUNING.party.field} + Command souls on the field, at most ${A.board}; relics and keystones may add more. Summons and shadows stand past it.` + (run ? ` Now: ${fieldCap(run)} (${fieldRule(run)}).` : ''),
  will: () => `Arise's cap and tier rise with it, and each point fills the Monarch's gauge ${pct(TUNING.monarch.willHaste)} faster.`,
  banner: () => 'A Marshal\'s domain covers its banner: it never falters there and keeps every order.',
  captain: () => 'Kill a foe captain and its cohort falters for the rest of the battle and hunts on its own. Your souls are captains of their summons the same way.',
  summon: () => `${ARMY_TEXT.summon} Summons count toward synergies, take no place on the field, pay no essence and are never recruited. Prep shows them faint on the tiles they will likely take; a held soul's appear beside it as it enters.`,
  ossuary: (run) => `Drag a soul onto a tile or another soul to field or swap it, or into the ossuary to keep it out of battle. A soul leaves the ossuary for an empty tile only while the field has room; it can always swap. A full retinue releases one before it recruits. The ${relicDef('ossuary_key').name} holds ${relicDef('ossuary_key').roster} more.` +
    (run ? ` Now: ${inOssuary(souls(run.state.party)).length} in the ossuary, ${souls(run.state.party).length}/${rosterCap(run)} souls.` : ''),
  detachment: (run) => `${ORDER_TEXT.pick} Each wears a colour: its square, the arrow to it, a tag on its souls. In battle the plans lie faint under the units.` +
    (run ? ` Now: ${run.state.detachments.length ? run.state.detachments.map((d) => `${d.id}, ${planText(d.plan)}`).join('; ') : 'none, so every soul Hunts at once'}.` : ''),
  hunt: () => ORDERS.where.hunt.desc,
  stay: () => `${ORDERS.where.stay.desc} ${ORDER_MORE.summon}`,
  move: () => `${ORDERS.where.move.desc} ${say('Press Move, then click', 'Tap Move, then')} any cell of the board: your camp, the open ground or their formation. A square past the domain is drawn faded: a one-way trip.`,
  braced: () => ORDER_MORE.reaction,
  held: () => `${ORDER_MORE.held} ${ORDER_TEXT.wave}`,
  gauge: () => `It uses the first ability in its list whose condition holds and that has a target in reach, saving gauge for it. Walking is off the gauge, one tile every ${secs(TUNING.board.stepTicks)} for everyone, so the gauge fills on the march. It banks only up to its costliest ability.`,
  engaged: () => 'Units block the way, friend or foe; a flanker slips through them on any plan, not only Hunt. Corpses block no one.',
  escalation: () => `${secs(TUNING.escalation.startTick)} after the start or the last entry, yours or theirs (${secs(TUNING.escalation.startTick * TUNING.escalation.bossMult)} in the boss's room), all damage ramps +${pct(TUNING.escalation.perTick * 1000 / TUNING.tick.ms)} a second, up to ×${TUNING.escalation.max}, never later than ${secs(TUNING.escalation.startTick * TUNING.escalation.bossMult)} after the last foe entered.`,
  ceiling: () => 'Counted from the start if no foe entered later.',
  wave: () => `${ENEMY_TEXT.waves} ${ENEMY_TEXT.entry} Each wave is scouted like the first, and the defeat screen names the wave a killer came with.`,
  siege: () => ENEMY_TEXT.court(),
  essence: () => `More for stronger foes. It buys levels (up to ${TUNING.level.cap}), path tiers, one recruit after a win (at the level it fought), promotions and Monarch points.`,
  path: () => `Each kind has two or three. Tiers I–III follow the first (${TUNING.essence.tier.slice(0, 3).join(' / ')} essence), and third tiers change what a soul does. ${RANK_TEXT.second}`,
  soldier: () => RANK_TEXT.promote,
  knight: () => RANK_TEXT.knight,
  marshal: () => `${RANK_TEXT.marshal} Its domain moves with it, and shadows raised there join its banner.`,
  synergy: () => `Steps stack: Undead 6 holds Undead 2 and 4 too. Ranger's are at 3, 6 and 8. ${COUNT_NOTE}`,
  rule: () => 'The battle names a rule when it strikes. Deep down, foes can hold one against you.',
  bond: () => 'Set by the formation when a battle begins and kept all battle: with the one beside it in its row, or right behind or ahead of it in its lane. One entering later, a summon or a shadow takes those of where it enters or rises. The Monarch neither holds nor gives one. ◆ marks a bonded soul in prep.',
  relic: () => 'Reliquaries and elites offer them, free. A trigger fires in battle for your side only, and its name flashes over the one it fired for.',
  keystone: () => `From floor ${TUNING.keystone.fromFloor}, a won elite and a rite each offer ${TUNING.keystone.offer} you do not hold: take one, free. None ever revives the Monarch.`,
  undying: () => KEYSTONE_MORE.undying
}
// Icons for the keywords that have one.
const KW_ICON = { monarch: 'crown', dominion: 'dominion', command: 'command', will: 'will', ossuary: 'bone', summon: 'hood', essence: 'soul', keystone: 'keystone', relic: 'reliquary', soldier: 'soldier', knight: 'knight', marshal: 'marshal', hunt: 'o-hunt', stay: 'o-stay', move: 'o-move', siege: 'siege', held: 'w-time' }
const WHEN_ICON = { once: 'w-once', time: 'w-time', struck: 'w-struck', wave: 'w-wave', falls: 'w-falls' }

// Every term and rule, by section: { name, entries: [{ name, line, more?, sys?, icon? }] }. A line is one
// sentence; `more` holds the rest of the rule.
function glossary (run) {
  const fromKw = (id) => ({ name: KEYWORDS[id].name, sys: KEYWORDS[id].sys, line: KEYWORDS[id].line, more: KW_MORE[id]?.(run) ?? null, icon: KW_ICON[id] })
  const group = (g) => Object.keys(KEYWORDS).filter((id) => KEYWORDS[id].group === g).map(fromKw)
  const shown = ROLE_LIST.filter((r) => !r.hidden)
  const unhealable = run && holds(run.state, 'unhealable')
  return [
    { name: 'You', entries: group('You') },
    { name: 'The army', entries: group('Army') },
    { name: 'Orders', entries: [...group('Orders'), ...Object.entries(ORDERS.when).map(([k, o]) => ({ name: o.name, sys: 'orders', icon: WHEN_ICON[k], line: o.desc }))] },
    {
      name: 'The battle',
      entries: [...group('Battle'),
        { name: 'Winning', sys: 'essence', line: 'Every foe fallen and none still to come, or the Sovereign slain.', more: 'You lose the instant the Monarch falls, and a lost battle ends the run.' },
        { name: 'Walking', line: `One tile every ${secs(TUNING.board.stepTicks)} for everyone, whatever its speed, until a foe is in reach.`, more: 'Melee reaches the 8 tiles around; a ranged ability, its range in tiles.' },
        { name: 'Camp', sys: 'domain', line: `Your ${COLS}×${CAMP_ROWS} cells, a new layout each floor; walls block walking, not bolts.`, more: `The foes always come from above: their formation, ${ROWS} rows deep, stands across ${TUNING.board.gap} row${TUNING.board.gap === 1 ? '' : 's'} of open ground, so the walls decide which way their melee walks.` },
        {
          name: 'Controls',
          line: 'Mouse: hover anything for its tooltip (hold Shift for a card\'s details), click to act, drag a soul onto a tile or another soul to move or swap them. Touch: tap to act, long-press for a tooltip (More ▾ opens its details; the next tap closes it), drag a soul to move or swap it.',
          more: 'Keys: Enter begins (a run, a battle); in battle Space pauses, 1/2/4 set the speed, S or Esc skips (none changes the outcome); anywhere H or ? opens this, M mutes. ' +
            'The board (Tab to it): the arrows move a cursor, Enter or Space selects what is under it, X swaps the selected soul with it, Shift+Enter or Shift-click picks souls for a detachment, Esc drops a selection. A button or tab you Tab to takes Enter or Space itself. ' +
            'Map: 1–9 enter a glowing room, R / C show the Route or the Camp. Spoils: 1–9, 0, then Q, W… take a card; ← → go between the steps; S moves on. The end: Enter descends (or starts a new run when the run is over), N starts a new run. ' +
            'By touch: a tap on a room scouts it and a second tap enters it (or its tooltip\'s Enter ▸); Pick in the Orders tab picks souls for a detachment; a tap on the selected soul drops it; a swipe up or down on the ossuary scrolls it, sideways lifts a soul; the battle bar has pause, speed, skip and this help.'
        }]
    },
    {
      name: 'Rooms',
      entries: [...['fight', 'elite', 'siege', 'reliquary', 'rite', 'altar', 'boss'].map((t) => ({ name: ROOM[t].name, icon: t, sys: t === 'boss' || t === 'elite' || t === 'siege' ? 'foe' : 'relic', line: ROOM[t].text,
        more: [ROOM_MORE[t], t === 'altar' && unhealable && 'You hold Court of Bone: not the Monarch.'].filter(Boolean).join(' ') || null })),
      { name: 'The deep', icon: 'stairs', sys: 'foe', line: DEEP_TEXT.descend, more: `${DEEP_TEXT.growth} ${DEEP_TEXT.fall}${run && depthOf(run.state.floor) > 0 ? ` ${DEEP_TEXT.now(run.state.floor)}` : ''}` }]
    },
    {
      name: 'The foes',
      entries: [...group('Foes'),
        { name: 'Captains', sys: 'foe', line: ENEMY_TEXT.captains, more: 'The scouted formation flags each captain with its cohort\'s size.' },
        { name: 'Their orders', sys: 'foe', line: ENEMY_TEXT.orders, more: 'What you scout is who comes, where they stand and when: never what they mean to do.' },
        { name: 'The court', sys: 'foe', line: ENEMY_TEXT.court() }]
    },
    { name: 'Threats', entries: group('Threats') },
    { name: 'Growth', entries: group('Growth') },
    {
      name: 'Roles',
      entries: shown.map((r) => ({ name: r.name, line: `${BEHAVIOURS[r.move].name}, strikes the ${r.target === 'weakest' ? 'lowest HP%' : 'nearest'}; ${ROW_NAMES[r.autoRow]} row by default.`, more: BEHAVIOURS[r.move].desc }))
    },
    {
      name: 'Stats',
      entries: [
        { name: 'HP', icon: 'hp', line: 'Health; a unit at 0 falls.' },
        { name: 'ATK', icon: 'atk', line: 'Scales damage and healing.' },
        { name: 'DEF', icon: 'def', line: `Damage taken × ${TUNING.damage.defConstant} / (${TUNING.damage.defConstant} + DEF).` },
        { name: 'SPD', icon: 'spd', line: 'Fills the gauge faster.' },
        { name: 'ACC', icon: 'acc', line: 'Hit chance is ACC / (ACC + EVA).' },
        { name: 'EVA', icon: 'eva', line: 'Dodging: see ACC.' },
        { name: 'CRT', icon: 'crt', line: `Chance of a ×${TUNING.crit.mult} critical hit.` }]
    },
    { name: 'Statuses', entries: group('Statuses') },
    {
      name: 'Synergies',
      entries: [...LADDERS.map((l) => {
        const top = l.steps.at(-1).syn
        return { name: l.name, sys: 'essence', line: l.steps.filter((st) => !st.syn.rule).map((st) => `${st.n}: ${st.syn.desc}`).join(' · '), more: top.rule ? `${l.steps.at(-1).n}: ${ruleName(top)}, a rule. ${sentence(ruleText(top))}` : null }
      }), ...PACTS.map((syn) => ({ name: syn.name, sys: 'essence', line: syn.desc }))]
    },
    { name: 'Bonds', entries: BONDS.map((b) => ({ name: b.name, sys: 'orders', line: b.desc })) },
    {
      name: 'Relics',
      entries: [...TRIGGERS.map((on) => ({ name: TRIGGER_TEXT[on].name, sys: 'relic', line: `Fires when ${TRIGGER_TEXT[on].when}` })),
        ...RELIC_LIST.map((r) => ({ name: r.name, sys: 'relic', icon: 'reliquary', line: r.desc }))]
    },
    { name: 'Keystones', entries: KEYSTONE_LIST.map((k) => ({ name: k.name, sys: 'keystone', icon: 'keystone', line: k.desc, more: KEYSTONE_MORE[k.id] })) }
  ]
}

// How to play: a dialog filling most of the frame, one view at a time behind two tabs. Basics: the primer
// (the goal, the loop, what kills you) and what your run holds now. Glossary: every term, filtered as you type.
// The search box sits in the head over both, so typing in it (it has the focus on open) goes to the glossary.
// An entry is its term and one line; one with more to its rule is a fold, the whole entry its toggle, opened
// when the search matches only in the rest. The search box takes the keys: Esc closes, and H or ? close while
// it is empty. run: the run in play, if any, so the rules can also say where you stand now.
export function helpOverlay (onClose, run = null) {
  const s = run?.state
  const none = h('p', { class: 'dim gl-none', hidden: true }, 'Nothing matches.')
  const sections = glossary(run).map((g) => {
    const items = g.entries.map((e) => {
      const row = h('div', { class: 'gl-row' },
        e.icon && h('span', { class: 'gl-ico', style: e.sys ? `color:var(--c-${e.sys})` : null }, icon(e.icon, 18)),
        h('b', { class: 'gl-term', style: e.sys ? `--k:var(--c-${e.sys})` : null }, e.name), ' ', h('span', { class: 'gl-line' }, e.line))
      const el = e.more
        ? h('details', { class: 'gl-entry gl-more' }, h('summary', null, row), h('p', null, e.more))
        : h('div', { class: 'gl-entry' }, row)
      return { el, det: e.more ? el : null, head: `${g.name} ${e.name} ${e.line}`.toLowerCase(), more: (e.more ?? '').toLowerCase() }
    })
    // A section folds to its heading, so the first screen is the primer; a search opens what matches.
    // Its count: every entry, or those a search matches.
    const n = h('span', { class: 'gl-n' }, g.entries.length)
    return { items, n, el: h('details', { class: 'gl-sec' }, h('summary', null, g.name, n), h('div', { class: 'gl-items' }, items.map((x) => x.el))) }
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
      const any = hits > 0
      sec.n.textContent = hits
      sec.el.hidden = !any
      sec.el.open = !!q && any
      shown += any
    }
    none.hidden = shown > 0
  }
  const search = h('input', {
    type: 'search', class: 'gl-search', placeholder: 'Search: falter, wave, Brittle…', 'aria-label': 'Search the rules', spellcheck: 'false',
    oninput: filter,
    // Esc always closes; H or ? close it too while the box is empty, and type once it holds a word.
    onkeydown: (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' || (['h', 'H', '?'].includes(e.key) && !search.value)) { e.preventDefault(); onClose() }
    }
  })
  const threats = Object.keys(THREATS)
  // The tips strip every screen can show (ui.js guide), closed on its own after a first visit: back on all of them.
  const tipsBack = h('button', {
    class: 'small ghost', onclick: () => { for (const k of ['map', 'prep']) prefs.set('guide:' + k, 'on'); tipsBack.textContent = 'Tips are back on the next screen' }
  }, 'Show the tips again')
  const basics = h('div', { class: 'help-view basics' },
    h('p', { class: 'lede' }, `Slay the Hollow Sovereign at the bottom of floor ${TUNING.run.floors} to clear the run, then descend as deep as you dare.`),
    h('ol', { class: 'primer' },
      h('li', null, 'You are the ', kw('monarch'), '. You never strike, and ', h('b', { class: 'warn' }, 'if you fall, the run ends'), '.'),
      h('li', null, 'Pick rooms on the map. Battles pay ', kw('essence'), ' and one of the slain to recruit; the rest of your souls wait in the ', kw('ossuary'), '.'),
      h('li', null, 'Place yourself and your souls in the camp. Keep them in your ', kw('domain'), ', or they ', kw('falter'), '.'),
      h('li', null, 'Give ', kw('detachment', 'detachments'), ' a plan (', kw('hunt'), ', ', kw('stay'), ', ', kw('move'), ', now or ', kw('held'), '), then Begin: it plays out alone.'),
      h('li', null, 'You ', kw('arise', 'raise'), ' the slain as ', kw('shadow', 'shadows'), '. Between rooms, spend on souls (paths raise ', kw('summon', 'summons'), '), ', kw('dominion'), ', ', kw('command'), ' and ', kw('will'), '.'),
      h('li', null, 'What kills you: ', threats.map((id, i) => [i ? ', ' : '', kw(id)]), '. Each is visible before Begin.')),
    // Where the run stands now, a line each.
    s && h('div', { class: 'gl-run' },
      h('span', null, kw('monarch'), ` ${monarchOf(s).lvl > 0 ? `Lv ${monarchOf(s).lvl} · ` : ''}${monarchOf(s).hp}/${monarchOf(s).maxHp} HP · ${MONARCH_STATS.map((k) => `${MONARCH_TEXT[k].name} ${s.monarch[k]}`).join(' · ')}`),
      h('span', null, kw('ossuary'), ` ${inOssuary(souls(s.party)).length} kept · souls ${souls(s.party).length}/${rosterCap(run)} · ${fielded(souls(s.party)).length}/${fieldCap(run)} on the field`),
      h('span', null, kw('detachment', 'Detachments'), ` ${s.detachments.length}/${A.detachments}`),
      h('span', null, kw('relic', 'Relics'), ` ${s.relics.length ? s.relics.map((id) => relicDef(id).name).join(', ') : 'none'}`),
      h('span', null, kw('keystone', 'Keystones'), ` ${s.keystones.length ? s.keystones.map((id) => keystoneDef(id).name).join(', ') : 'none'} (${s.keystones.length}/${TUNING.keystone.max})`),
      depthOf(s.floor) > 0 && h('span', null, DEEP_TEXT.now(s.floor)),
      holds(s, 'unhealable') && h('span', { class: 'warn' }, 'Court of Bone: nothing heals the Monarch.')),
    h('div', { class: 'help-foot' },
      h('p', { class: 'dim' }, say([h('kbd', null, 'H'), ' or ', h('kbd', null, '?'), ' opens this anywhere, and closes it while the search box is empty; ', h('kbd', null, 'Esc'), ' always closes it.'],
        'The ? button (How to play, on the title) opens this from any screen; ✕, or a tap outside it, closes it.')),
      tipsBack))
  const gloss = h('div', { class: 'help-view glossary' }, sections.map((x) => x.el), none)
  // One view at a time: the tab row, and the view under it scrolling in the dialog's body.
  const tabs = h('div', { class: 'tabs help-tabs', role: 'tablist' })
  const body = h('div', { class: 'help-body' })
  let on = null
  function view (id) {
    if (id === on) return
    on = id
    fill(tabs, [['basics', 'Basics'], ['glossary', 'Glossary']].map(([k, name]) =>
      h('button', { class: 'tab' + (k === id ? ' on' : ''), role: 'tab', 'aria-selected': k === id ? 'true' : 'false', 'data-tab': k, onclick: () => view(k) }, name)))
    fill(body, id === 'basics' ? basics : gloss)
    body.scrollTop = 0
  }
  view('basics')
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal help', role: 'dialog', 'aria-label': 'How to play' },
      h('div', { class: 'help-head' },
        h('h2', { class: 'modal-title' }, 'How to play'),
        h('label', { class: 'gl-bar' }, icon('search', 20), search),
        h('button', { class: 'icon-btn close', 'aria-label': 'Close', onclick: onClose, tip: () => 'Close (Esc)' }, icon('close', 22))),
      tabs,
      body))
  return el
}

// ── the Monarch's card ───────────────────────────────────────────────────────────────────────────

// What one more point of a Monarch stat gives, in a line (its +1 button's hover; MONARCH_TEXT has the rule).
export function monarchNextText (run, k) {
  const s = run.state
  if (k === 'dominion') return `Next point: domain ${domainOf(s) + 1} tiles.`
  if (k === 'command') return `Next point: ${Math.min(TUNING.army.board, fieldCap(run) + 1)} souls on the field.`
  const w = 1 + s.monarch.will
  return `Next point: ${TUNING.monarch.raises * (w + 1) * realmOf(run).raises} raises, tier ≤ ${TUNING.monarch.raiseTier + w}, Arise +${pct(TUNING.monarch.willHaste * w)} sooner.`
}
