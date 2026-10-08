// Rules text, generated from the content data so it is never out of date: unit stat cards, ability
// and status text, room and threat tooltips, the synergy tracker and How to play.
import { TUNING } from './tuning.js'
import { unitDef, abilityDef, statusDef, relicDef, KIN, ROLES, ROLE_LIST, BEHAVIOURS, SYNERGIES, RELIC_LIST, BONDS, THREATS, SHAPES, ORDERS, GRADES, KEYSTONE_LIST, keystoneDef, TRIGGERS } from './content.js'
import {
  statsOf, activeSynergies, synergyActive, baseStats, COLS, ROWS, slotAt, rangeOf, isAllyShape, activeBonds, CAMP_ROWS, pathDef, abilitiesOf, auraOf,
  tileX, tileY, DEPTH, distance, deployTile, makeUnit
} from './sim/unit.js'
import {
  foeMods, fielded, souls, monarchOf, domainOf, fieldCap, baseField, monarchCost, monarchPoints, MONARCH_STATS, armyLayout, musterCost, waits,
  detachmentOf, marshalOf, faltersIn, holds, isMonarch, depthOf
} from './sim/run.js'
import { h, icon, portrait } from './dom.js'

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
// cohorts' members standing on the board. A held detachment's souls start off the board, so they count only
// once they enter. The Monarch (`u`) takes none of them: its stats are its points' (battle.js modsFor).
export const partyMods = (run, u = null) => u && isMonarch(u) ? [] : [...relicMods(run.state.relics), ...keystoneMods(run),
  ...activeSynergies([...boardField(run), ...armyOf(run).members], aliasOf(run)).flatMap((s) => s.mods)]
const livingField = (run) => fielded(run.state.party).filter((u) => u.hp > 0)
// Whether a soul's detachment starts later: it waits behind the camp, off the board, until its start.
export const isHeld = (s, u) => waits(detachmentOf(s, u.uid))
// Whether a detachment takes part in the next battle: a soul of it stands on the field, living. One whose
// souls are all benched or fallen sits the battle out (battleSetup leaves it out): no square, no arrow.
export const takesPart = (s, d) => fielded(s.party).some((u) => u.hp > 0 && d.members.includes(u.uid))
// The living souls (and the Monarch) standing on the board when the battle begins: held ones wait.
export const boardField = (run) => livingField(run).filter((u) => !isHeld(run.state, u))

// The army as the next battle will stand it (armyLayout), as units the cards, bonds and synergies can
// read: each member a rank-and-file body of its kind at the muster level, on its cell, with a uid of its
// own ('r0', 'r1'…: never a soul's, never the Monarch's); the reserve the same with slot −1, in the order
// it enters; `held`, the detachments that start later, in the order they enter once called: each captain
// (a copy of the soul, still on its cell) and each body (slot −1), with `det`, its detachment's id.
export function armyOf (run) {
  const s = run.state
  const { members, reserve, held } = armyLayout(s)
  const body = (b, i, slot) => ({ ...makeUnit(b.id, { uid: `r${i}`, lvl: s.muster, slot }), cohortOf: b.cohortOf, rank: true })
  const n = members.length + reserve.length
  return {
    members: members.map((b, i) => body(b, i, b.slot)),
    reserve: reserve.map((b, i) => body(b, members.length + i, -1)),
    held: held.map((b, i) => ({ ...(b.uid !== undefined ? s.party.find((u) => u.uid === b.uid) : body(b, n + i, -1)), det: b.det }))
  }
}

// Foes of a room on the current floor start with the floor's multipliers plus their synergies: those of the
// formation they stand in (`foes`: the room's first by default, or one of its later waves).
export const roomFoeMods = (run, node, foes = node.foes) => [...foeMods(run.state.floor, node.type === 'boss'), ...activeSynergies(foes).flatMap((s) => s.mods)]

// The formation bonds one unit holds among `units` (its side's formation), and what they add; `alias` as
// for activeBonds (your side's, under Mimicry).
export const heldBonds = (units, u, alias = null) => activeBonds(units, { alias }).filter((b) => b.uid === u.uid)
export const bondMods = (units, u, alias = null) => heldBonds(units, u, alias).flatMap((b) => b.bond.mods)
export const bondNotes = (units, u, alias = null) => heldBonds(units, u, alias).map((b) =>
  `Bond: ${b.bond.name} with ${unitDef(units.find((x) => x.uid === b.partner).id).name}. ${b.bond.desc.split(': ').at(-1)}`)

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

function effectText (e, st) {
  const est = (power) => Math.round(power * st.atk / TUNING.damage.atkDivisor)
  switch (e.op) {
    case 'damage': return [h('b', null, `${e.power} power`), ' damage ', h('span', { class: 'dim' }, `(≈${est(e.power)} before DEF)`)]
    case 'heal': return [e.self ? 'heals itself ' : 'heals ', h('b', null, `${e.power} power`), h('span', { class: 'dim' }, ` (≈${Math.round(est(e.power) * st.heal.given)} HP)`)]
    case 'apply_status': {
      const s = statusDef(e.status)
      return [e.chance !== undefined ? `${pct(e.chance)} chance of ` : '', h('b', { class: 'status' }, s.name), ` for ${secs(e.dur ?? s.dur)}: ${s.desc.replace(/\.$/, '')}`]
    }
    case 'cleanse': return `removes up to ${e.count} debuffs`
    case 'gauge': return e.amount <= -1000 ? 'empties its gauge (bosses are immune)' : `${e.amount < 0 ? 'drains' : 'adds'} ${Math.abs(e.amount)} gauge (bosses are immune)`
    case 'raise': return ['raises up to ', h('b', null, e.count), ' of the field\'s dead, yours or its own, as ', h('b', null, 'shadows'), ` on its side: the strongest first, then the nearest. Its shadows falter (${FALTER} damage)`]
    default: return e.op
  }
}

function reachTag (a) {
  if (a.melee) return h('span', { class: 'tag-melee' }, 'Melee')
  const r = rangeOf(a)
  if (isAllyShape(a.shape) && !Number.isFinite(r)) return null
  return h('span', { class: 'tag-ranged' }, Number.isFinite(r) ? `Range ${r}` : 'Any range')
}

// realm: the Monarch's { domain, will } (realmOf, or a battle's), for Arise's numbers; without one the
// text gives the rule.
export function abilityBlock (id, st, realm = null) {
  const a = abilityDef(id)
  return h('div', { class: 'ability' },
    h('div', { class: 'ab-head' },
      h('b', null, a.name),
      h('span', { class: 'dim right' }, `${a.castCost} gauge · ${fillTime(st, a.castCost)}`)),
    a.shape === 'corpse'
      ? h('div', { class: 'ab-body' }, h('span', { class: 'tag-domain' }, 'Domain'), ' ', ariseText(realm))
      : h('div', { class: 'ab-body' },
        reachTag(a),
        ` Targets ${a.shape === 'all_allies' && Number.isFinite(rangeOf(a)) ? `every ally within ${rangeOf(a)} tiles` : a.shape === 'all' && a.range ? `every foe within ${a.range} tiles` : SHAPE[a.shape]}: `,
        a.effects.map((e, i) => [i ? '; ' : '', effectText(e, st)]),
        '.',
        a.cond && h('div', { class: 'dim' }, `Only ${a.cond}.`)))
}

// ── the Monarch ──────────────────────────────────────────────────────────────────────────────────

// The Monarch's reach and Will, as Arise and faltering read them, and what the keystones do to them: Arise's
// cap times `raises` and a `tithe` of the Monarch's max HP a shadow (Blood Tithe), the domain on the front
// (`crown`, Vanguard Crown), and shadows that stay after a win (`keep`, Hollow Court). A battle's `ks` stands in
// for `raises` and `tithe`.
export const realmOf = (run) => ({
  domain: domainOf(run.state), will: run.state.monarch.will,
  raises: run.state.keystones.reduce((n, id) => n * (keystoneDef(id).raises ?? 1), 1),
  tithe: run.state.keystones.reduce((n, id) => n + (keystoneDef(id).tithe ?? 0), 0),
  crown: holds(run.state, 'crown'),
  keep: holds(run.state, 'keep')
})
// The highest tier Arise raises (TUNING.monarch.raiseTier + Will), and how many it may raise a battle
// (TUNING.monarch.raises × (1 + Will), times Blood Tithe's 2).
const raises = (realm) => (realm ? TUNING.monarch.raiseTier + realm.will : `${TUNING.monarch.raiseTier} + Will`)
const raiseCap = (realm) => (realm ? TUNING.monarch.raises * (1 + realm.will) * (realm.raises ?? realm.ks?.raises ?? 1) : `${TUNING.monarch.raises} × (1 + Will)`)
const titheOf = (realm) => realm?.tithe ?? realm?.ks?.tithe ?? 0
const reach = (realm) => (realm ? `${realm.domain} tiles` : `${TUNING.monarch.domain} + Dominion tiles`)
const FALTER = `×${TUNING.monarch.falter}`

function ariseText (realm) {
  return [`Targets a fallen foe of tier ≤ ${raises(realm)} (never a boss) lying in its domain, within ${reach(realm)}, on a tile no one living stands on: `,
    'the highest tier, then the nearest. It ', h('b', null, 'rises as a shadow'), ` on your side, at its level, with ${pct(TUNING.monarch.raiseHp)} of its HP and its own abilities. `,
    `At most ${raiseCap(realm)} a battle. Its shadows stand past the board's ${TUNING.army.board}: they take no place a body entering needs. ` +
    (TUNING.monarch.shadowFalter ? `A shadow falters (${FALTER} damage), unless it rose within a Marshal's domain: then it joins that Marshal's banner and fights at full strength while it stays within ${TUNING.ranks.domain} tiles of it. `
      : `A shadow falters like a soul, outside the domain; one that rises within a Marshal's domain joins that Marshal's banner. `),
    `It ${realm?.keep ? 'stays after a won battle if it still stands, as rank-and-file in the ossuary (Hollow Court)' : 'is gone when the battle ends'}. With no such corpse in reach, the Monarch banks its gauge.`,
    titheOf(realm) > 0 && ` Blood Tithe: each shadow costs the Monarch ${pct(titheOf(realm))} of its max HP, and it raises none while its HP is at or below that cost.`]
}

// What sets the field size (banners: captains), as the run has it: "3 + Command", with "+ relics" once a
// relic adds to it, and the board's cap once it binds.
const relicField = (run) => run.state.relics.reduce((n, id) => n + (relicDef(id).field ?? 0), 0)
const keystoneField = (run) => run.state.keystones.reduce((n, id) => n + (keystoneDef(id).field ?? 0), 0)
export const fieldRule = (run) => {
  const raw = baseField(run.state) + run.state.monarch.command + relicField(run) + keystoneField(run)
  return `${baseField(run.state)} + Command${relicField(run) ? ' + relics' : ''}${holds(run.state, 'field') ? ' + keystones' : ''}${raw > TUNING.army.board ? `, at most ${TUNING.army.board}` : ''}`
}

// What each Monarch stat does, with the numbers it gives now and after one more point.
export const MONARCH_TEXT = {
  dominion: {
    name: 'Dominion',
    now: (run) => `Domain: ${domainOf(run.state)} tiles`,
    desc: (run) => `The domain reaches ${domainOf(run.state)} tiles from ${holds(run.state, 'crown') ? 'your front-most captain (Vanguard Crown)' : 'the Monarch'} in every direction, diagonals counting as one. ` +
      `A soul outside it falters (${FALTER} damage dealt), and Arise only reaches corpses inside it. A point: ${domainOf(run.state) + 1} tiles.` +
      (run.state.keystones.some((id) => keystoneDef(id).domain) ? ` (${TUNING.monarch.domain} + Dominion, ${run.state.keystones.filter((id) => keystoneDef(id).domain).map((id) => `${keystoneDef(id).domain > 0 ? '+' : '−'}${Math.abs(keystoneDef(id).domain)} ${keystoneDef(id).name}`).join(', ')}.)` : '')
  },
  command: {
    name: 'Command',
    now: (run) => `Banners: ${fieldCap(run)} · cohorts of ${run.state.monarch.command}`,
    desc: (run) => {
      const c = run.state.monarch.command
      return `Up to ${fieldCap(run)} souls stand on the field with the Monarch as captains, one banner each (${fieldRule(run)}), and each may lead a cohort of up to ${c} rank-and-file (Command; a Knight ${TUNING.ranks.cohort[1]} more, a Marshal ${TUNING.ranks.cohort[2]} more). ` +
        `A point: ${Math.min(TUNING.army.board, fieldCap(run) + 1)} banners, cohorts of ${c + 1}.`
    }
  },
  will: {
    name: 'Will',
    now: (run) => `Raises ${raiseCap(realmOf(run))}, tier ≤ ${TUNING.monarch.raiseTier + run.state.monarch.will}`,
    desc: (run) => {
      const w = 1 + run.state.monarch.will
      const k = TUNING.monarch.raises
      const t = TUNING.monarch.raiseTier + run.state.monarch.will
      const x = realmOf(run).raises
      return `Arise raises up to ${k * w * x} shadows a battle (${k} × (1 + Will)${x > 1 ? `, ×${x} by Blood Tithe` : ''}), from foes of tier ${t} or lower, and after a win the first ${w} bod${w > 1 ? 'ies' : 'y'} bound are free. ` +
        `A point: ${k * (w + 1) * x} a battle, tier ≤ ${t + 1}, ${w + 1} free.`
    }
  }
}

export const monarchPointText = (run) =>
  `A point costs ${monarchCost(run)} essence (${TUNING.monarch.cost} + ${TUNING.monarch.costPerPoint} per point bought; ${monarchPoints(run.state)} so far) and adds ${TUNING.monarch.hpPerPoint} max HP, ` +
  (holds(run.state, 'unhealable') ? 'but heals nothing: under Court of Bone nothing heals the Monarch.' : 'healing the Monarch by as much.')

// ── the army ─────────────────────────────────────────────────────────────────────────────────────

const A = TUNING.army
// "1 Grave Ghoul", "3 Grave Ghouls".
export const bodies = (id, n) => `${n} ${unitDef(id).name}${n === 1 ? '' : 's'}`
// Who a captain can lead: bodies of its kin or of its role.
export const leadsText = (id) => `${KIN[unitDef(id).kin].name} or ${ROLES[unitDef(id).role].name}`

export const ARMY_TEXT = {
  cohort: (run) => `A fielded soul is a captain, and may lead a cohort: up to Command${run ? ` (${run.state.monarch.command})` : ''} rank-and-file (a Knight ${TUNING.ranks.cohort[1]} more, a Marshal ${TUNING.ranks.cohort[2]} more) of one kind that shares its kin or its role, ` +
    'from the bodies standing in the ossuary that no other cohort leads. The captain and its cohort are one banner.',
  shapes: 'Its shape says where the members stand around the captain when the battle begins: a cell walled, off the camp or taken passes to the next in the shape, then to the open cell nearest the captain.',
  ai: `In battle a member strikes whatever comes in reach and otherwise keeps within a tile of its captain. If its captain falls, it falters (${'×' + TUNING.monarch.falter} damage) for the rest of the battle and hunts on its own.`,
  ossuary: 'The ossuary keeps the rank-and-file as counts, per kind: how many stand, and how many have fallen. The fallen stand again at an altar. Bodies have no paths and no levels of their own.',
  board: `The board holds ${A.board} of your bodies at once (captains and members, and the Legion's shadows once risen; Arise's shadows, held detachments and the Monarch not counted). A body with no room sits the battle out, behind the camp: ` +
    `only a held detachment (a later start) enters once the battle is under way, beside the Monarch, one at a time. Each entry restarts the escalation clock, up to a point (see How to play).`,
  bind: (run) => `After a win the slain may be bound into the ossuary as rank-and-file, up to as many of each kind as fell. ` +
    `The first ${run ? `${1 + run.state.monarch.will} (1 + Will)` : '1 + Will'} bound after each battle are free; each more costs ${A.bindPerTier} × its tier in essence.`,
  muster: (run) => {
    if (!run) return `Every rank-and-file body fights at the muster level, ${A.muster.start} at first: one purchase levels them all. The next level costs ${A.muster.cost} × level^${A.muster.exponent} essence (the current level), up to ${A.muster.cap}.`
    const m = run.state.muster
    return [`Every rank-and-file body fights at the muster level, ${m} now: one purchase levels them all.`,
      m >= A.muster.cap ? ` It is at its cap (${A.muster.cap}).` : ` Level ${m + 1} costs ${musterCost(run)} essence (${A.muster.cost} × ${m}^${A.muster.exponent}, the current level` +
        `${musterCost(run) < Math.round(A.muster.cost * Math.pow(m, A.muster.exponent)) ? ', less your level discount' : ''}), up to ${A.muster.cap}.`].join('')
  }
}

// ── ranks ────────────────────────────────────────────────────────────────────────────────────────

const RK = TUNING.ranks
// A rank's insignia, by grade: an icon in dom.js.
export const GRADE_ICON = ['soldier', 'knight', 'marshal']

// What promotion takes, and what each rank removes.
export const RANK_TEXT = {
  promote: `Feed a soul standing bodies of its kin from the ossuary, of any kinds of that kin, to promote it: ${RK.knight} make a Soldier a Knight, ` +
    `${RK.marshal} more make a Knight a Marshal. Bodies no cohort leads go first, the lowest tier first; then led ones, and their cohorts shrink. ` +
    'The bodies are gone for good, not fallen. Fallen bodies do not count. It costs no essence, and a benched or fallen soul may be promoted too.',
  soldier: 'A Soldier follows one path, tiers I–III.',
  knight: `A Knight may take one more tier: tier IV on its path (${TUNING.essence.tier[3]} essence), a rule rather than a percentage, or tier I of a second path of its kind. ` +
    `Not both: whichever it takes first rules out the other until it is a Marshal. A Knight deals ×${RK.might[1]} damage and takes ÷${RK.might[1]}.`,
  marshal: `A Marshal holds both: tier IV, and tiers I–III of a second path (a second signature ability). It carries a domain of its own, ${RK.domain} tiles around ` +
    'wherever it stands: there its banner (itself and its cohort) never falters, so none of it drops its orders, even beyond the Monarch\'s domain, and a shadow Arise raises there joins its banner. ' +
    `The Marshal itself never falters, and deals ×${RK.might[2]} damage and takes ÷${RK.might[2]}.`,
  second: 'A second path\'s tiers come on top of the first\'s. Two paths that remake the same ability, or that both grant an aura (a soul holds one), never pair.'
}

// Why path `b` cannot be a second path on top of path `a` (pathsClash): the ability both remake, or the aura.
export function clashText (id, a, b) {
  const pa = pathDef(id, a).tiers
  const swap = pathDef(id, b).tiers.slice(0, SECOND_TIERS).map((t) => t.ability?.replace).find((r) => r && pa.some((t) => t.ability?.replace === r))
  return swap ? `both remake ${abilityDef(swap).name}` : 'both grant an aura, and a soul holds one'
}

// The sim's own camp-side checks (run.js), under the names the UI uses: the Marshal whose domain covers a
// soul or member, and whether it starts the battle faltering.
export { marshalOf }
export const startsFaltering = faltersIn

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
  captains: `From floor 2 the foes march as an army too: a fight's formation has ${SP.captains.fight} captain${SP.captains.fight === 1 ? '' : 's'} and an elite's ${SP.captains.elite}, ` +
    `each leading a cohort of ${SP.cohort[1]} more of its own kind${cohortGrows > 0 ? ` (${SP.cohort[cohortGrows]} from floor ${cohortGrows + 1})` : ''}. The cohort keeps within a tile of its captain; kill the captain and its cohort falters (${FALTER} damage) and hunts on its own.`,
  orders: 'An elite\'s captains march under orders of their own, and their cohorts with them. The orders are never shown: a foe\'s lore hints at them, and you learn the rest by fighting it.',
  ordered: 'That is its kind\'s way: as an elite\'s captain, or one of its cohort, it may march under orders of its own instead. Its lore hints at them.',
  member: `Of a captain's cohort: it keeps within a tile of its captain. If the captain falls, it falters (${FALTER} damage) and hunts on its own; the Sovereign's court crumbles instead.`,
  // Whose cohort a foe is in (`captain`: its unit id).
  of: (captain) => unitDef(captain).boss ? `Of the ${unitDef(captain).name}'s court: it crumbles to dust the moment the Sovereign falls.` : `Of ${unitDef(captain).name}'s cohort.`,
  captain: (n, boss = false) => boss ? `Its court of ${n} walks with it. Kill it and every foe left on the field crumbles to dust with it.`
    : `A captain: its cohort of ${n} keeps within a tile of it. Kill it and they falter (${FALTER} damage) and hunt on their own.`,
  late: `A floor-1 elite brings a late pair: ${SP.late.n} more foes arrive at the far edge ${secs(SP.late.t)} into the battle.`,
  waves: `From floor ${W.floor} some rooms come in waves: every elite (${W.elite} waves), the fights from rank ${W.fightRank} on (${W.fight}), and sieges (${W.siege}). Each wave is a formation of its own, scouted like the first. ` +
    `It enters at the far edge, each foe in its lane (a cohort beside its captain), once the wave before is down to ${shareText(W.share)} of its foes, or ${secs(W.t)} after that wave began to enter.`,
  siege: `Siege rooms, from floor ${W.floor}: one battle of ${W.siege} waves with no prep between them. Each wave's essence is tallied as it falls and paid with the win.`,
  court: () => `Floor ${TUNING.run.floors}'s last room is a siege whose last wave is the Hollow Sovereign and its court of ${SP.court} undead. Its Grave Tide raises up to ${tide()} of the field's dead, yours or its own, ` +
    'as shadows on its side. Kill the Sovereign and its court crumbles to dust with it: the battle is won, and the court pays essence as if slain.',
  entry: 'Bodies enter one a tick on each side, yours beside the Monarch and theirs at the far edge, and every entry, yours or theirs, restarts the escalation clock, up to a point.'
}

// A room's foes, every wave's: the formation that stands from the start, then each later wave's.
export const roomFoes = (node) => [node.foes ?? [], ...(node.waves ?? []).map((w) => w.foes)].flat()
// A later wave (node.waves[k]) by name, and when it comes, as the scouts can tell it.
export const waveName = (node, k) => node.waves[k].when.at === 'time' ? 'The late pair'
  : node.waves[k].foes.some((f) => unitDef(f.id).boss) ? `Wave ${k + 2}: the Sovereign` : `Wave ${k + 2}`
export const waveWhen = (w) => w.when.at === 'time'
  ? `${w.foes.length} more arrive at the far edge at ${secs(w.when.t)}.`
  : `Enters at the far edge once the wave before is down to ${shareText(W.share)}, or ${secs(w.when.t)} after it began.`
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
export const whenText = (w) => w.at === 'time' ? `after ${secs(w.t)}` : { once: 'at once', struck: 'once the Monarch is struck', wave: 'once more foes enter', falls: 'once a body of yours falls' }[w.at]
export const whenTag = (w) => w.at === 'time' ? secs(w.t) : { once: 'at once', struck: 'struck', wave: 'wave', falls: 'falls' }[w.at]
// A plan in words: "Stay, at once", "Move to the open ground, lane 4, once a body of yours falls".
export const planText = (p) => `${ORDERS.where[p.where].name}${p.where === 'move' ? ` to ${tileText(p.square)}` : ''}, ${whenText(p.when)}`

export const ORDER_TEXT = {
  detachments: `Souls on the field may be formed into detachments, up to ${A.detachments}, each in its own colour, and each given a plan: Where and When. ` +
    'A soul is in one detachment at most, and its cohort goes with it. A soul in none Hunts, at once.',
  pick: 'Shift- or Ctrl-click souls on the field (or press Pick and click them) to pick them, then form a detachment of them or add them to one.',
  where: Object.values(ORDERS.where).map((o) => `${o.name}: ${o.desc}`).join(' '),
  when: Object.values(ORDERS.when).map((o) => `${o.name}: ${o.desc}`).join(' '),
  reaction: 'The reaction rule, for every unit on either side, whatever its plan: it strikes what is in reach (or saves its gauge for it); else a melee unit steps in to engage a foe within 2 tiles; ' +
    'else a ranged unit holds while a foe is in its range; else it follows its plan. So a unit on Stay or Move stops to fight, and goes back to its plan once the fight is done. ' +
    `A unit of yours on Stay within ${TUNING.orders.post} tile of the tile it holds is braced: it takes ${Math.round((1 - TUNING.orders.braced) * 100)}% less damage` + (TUNING.orders.holdFlank ? ', and holds the line: no foe slips through it or away from beside it.' : '.'),
  leash: `Outside the Monarch's domain only Hunt is heeded: a soul or body that falters drops its plan and Hunts for the rest of the battle, back inside or not. ` +
    'A Move to a square outside the domain is a one-way trip: the camp draws it faded. A Marshal never falters, nor does its banner within its own domain, so they keep their plans out there.',
  held: `A detachment that starts later waits behind the camp, off the board, and takes none of the ${A.board} places even once it enters: held bodies have ${TUNING.orders.reserve} places of their own. ` +
    `When its start comes, its captains and then their bodies enter beside the Monarch, one a tick, while fewer than ${TUNING.orders.reserve} held bodies stand, ahead of the reserve. ` +
    `A held soul keeps its camp cell, but takes its bonds where it enters. Every held soul and body enters fresh: with a full gauge, and Shielded for ${TUNING.orders.fresh / 20} s (takes 40% less damage).`,
  cohort: 'A cohort follows its captain\'s plan, within its leash: on Stay each member holds the tile it started on when that lies within its leash (else it keeps to its captain); on Move it keeps to its captain on the way; once its captain Hunts (it arrived, or faltered), so do its members.',
  flank: 'A Trickster passes through bodies on any plan.',
  wave: 'A wave start waits for more foes to enter the field during the battle: where none do, that detachment stays behind the camp all battle.'
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
  return w?.when.at === 'time' ? `The killer came with the late pair, which entered at the far edge ${secs(w.when.t)} into the battle.` : `The Monarch was struck down by the ${ordinal(k + 1)} wave, which entered from the far edge.`
}

export function statusLine (s) {
  const d = statusDef(s.id)
  return h('div', { class: 'status-line' }, h('b', { class: 'status' }, d.name), s.stacks > 1 ? ` ×${s.stacks}` : '',
    h('span', { class: 'dim' }, ` ${s.dur === 'battle' ? 'all battle' : secs(s.dur)} · ${d.desc}`))
}

// ── unit card ────────────────────────────────────────────────────────────────────────────────────

// u: a run unit, a battle unit or a scouted foe { id, lvl, slot }. opts.mods: the mods it fights with;
// opts.stats overrides them with live battle stats; opts.statuses lists live statuses; opts.notes adds
// lines at the bottom.
// realm: the Monarch's { domain, will } for Arise's numbers (see abilityBlock).
// `ordered`: a foe that may march under an elite captain's orders (its captain, or one of its cohort): its
// role's way of moving is then only its kind's, and the card says so without naming the order.
export function unitCard (u, { mods = [], stats = null, statuses = null, notes = [], foe = false, realm = null, ordered = false } = {}) {
  const d = unitDef(u.id)
  const st = stats ?? statsOf(u, mods)
  const hp = u.hp ?? null
  const maxHp = Math.round(st.hp)
  const shown = hp === null ? maxHp : Math.round(hp / (u.maxHp || 1) * maxHp)
  const stat = (label, v) => h('div', { class: 'stat' }, h('span', { class: 'dim' }, label), h('b', null, v))
  const next = !foe && !d.monarch && !u.shadow && !u.rank && u.path !== undefined && u.lvl < TUNING.level.cap && baseStats(u.id, u.lvl + 1)
  const now = baseStats(u.id, u.lvl)
  const path = u.path ? pathDef(u.id, u.path) : null
  const path2 = u.path2 ? pathDef(u.id, u.path2) : null
  // A soul's rank (GRADES): only souls have one, never a foe, the Monarch, a body or a shadow.
  const grade = !foe && !d.monarch && !u.rank && !u.shadow && u.grade !== undefined ? u.grade : null
  const aura = auraOf(u)
  return h('div', { class: 'card-tip' + (foe ? ' foe' : '') },
    h('div', { class: 'ct-head' },
      h('div', { class: 'ct-port' }, portrait(u.id, 52, shown <= 0)),
      h('div', null,
        h('div', { class: 'ct-name' }, d.name),
        h('div', { class: 'dim' }, `Level ${u.lvl} · ${d.kin ? `${KIN[d.kin].name} · ` : ''}${d.monarch ? 'you' : ROLES[d.role].name}${d.boss ? ' · Boss' : ''}${u.shadow ? ' · Shadow' : ''}${u.rank ? (foe ? ' · Cohort' : ' · Rank-and-file') : ''}`),
        grade !== null && h('div', { class: `ct-rank g${grade}` }, icon(GRADE_ICON[grade], 12), ` ${GRADES[grade].name}`),
        path && h('div', { class: 'ct-path' }, `${path.name} ${ROMAN[u.tier - 1]}`, path2 && ` · ${path2.name} ${ROMAN[u.tier2 - 1]}`),
        h('div', { class: 'ct-hp' },
          h('span', { class: 'hpbar' + (shown <= 0 ? ' dead' : shown / maxHp < 0.35 ? ' low' : '') }, h('span', { style: `width:${Math.max(0, Math.min(1, shown / maxHp)) * 100}%` })),
          h('span', null, shown <= 0 ? 'fallen' : `${shown} / ${maxHp} HP`)))),
    // The Monarch never strikes: its attack stats would mean nothing.
    h('div', { class: 'stats-grid' + (d.monarch ? ' three' : '') },
      !d.monarch && stat('ATK', Math.round(st.atk)),
      stat('DEF', Math.round(st.def)),
      stat('SPD', Math.round(st.spd)),
      !d.monarch && stat('ACC', Math.round(st.acc)),
      stat('EVA', Math.round(st.eva)),
      !d.monarch && stat('CRT', `${Math.round(st.crt)}%`)),
    (st.damage.dealt !== 1 || st.damage.taken !== 1 || st.gauge.rate !== 1) && h('div', { class: 'dim small' },
      [st.damage.dealt !== 1 && `damage dealt ×${st.damage.dealt.toFixed(2)}`, st.damage.taken !== 1 && `damage taken ×${st.damage.taken.toFixed(2)}`, st.gauge.rate !== 1 && `gauge rate ×${st.gauge.rate.toFixed(2)}`].filter(Boolean).join(' · ')),
    h('div', { class: 'ct-sec' }, 'Abilities ', h('span', { class: 'dim' }, '· in priority order')),
    abilitiesOf(u).map((id) => abilityBlock(id, st, realm)),
    aura && [h('div', { class: 'ct-sec' }, 'Aura ', h('span', { class: 'dim' }, `· within ${aura.range} tile${aura.range > 1 ? 's' : ''}`)), h('div', { class: 'ability' }, aura.desc)],
    path && [h('div', { class: 'ct-sec' }, `Path: ${path.name}`), pathTiers(path, u.tier)],
    path2 && [h('div', { class: 'ct-sec' }, `Second path: ${path2.name}`), pathTiers(path2, u.tier2, SECOND_TIERS)],
    statuses?.length > 0 && [h('div', { class: 'ct-sec' }, 'Statuses'), statuses.map(statusLine)],
    h('div', { class: 'ct-foot' },
      behaviourLine(d.role),
      foe && ordered && h('div', { class: 'dim' }, ENEMY_TEXT.ordered),
      d.monarch
        ? [h('div', { class: 'warn' }, 'It never strikes. If it falls, the battle and the run are lost.'),
            h('div', { class: 'dim' }, `Its level is the Monarch points bought: each adds ${TUNING.monarch.hpPerPoint} max HP. Nothing else does: no synergy, relic or keystone changes its stats. Guarding it is a matter of where you stand, not what you buy.`)]
        : u.rank && foe ? h('div', { class: 'dim' }, ENEMY_TEXT.member)
          : u.rank ? h('div', { class: 'dim' }, 'Rank-and-file: no path, and its level is the muster level. It keeps within a tile of its captain; if the captain falls, it falters and hunts.')
            : h('div', { class: 'dim' }, `${ROLES[d.role].name}s are placed in the ${ROW_NAMES[ROLES[d.role].autoRow]} row by default.`),
      grade !== null && h('div', { class: 'dim' }, `${GRADES[grade].name}: ${GRADES[grade].desc}`),
      // A foe's lore is the only hint of what it does about your camp: its orders are never shown.
      foe && d.flavour && h('div', { class: 'flavour' }, d.flavour),
      next && h('div', { class: 'dim' }, `Next level: +${next.hp - now.hp} HP, +${(next.atk - now.atk).toFixed(1)} ATK.`),
      notes.filter(Boolean).map((n) => h('div', { class: 'note-line' }, n))))
}

export const ROMAN = ['I', 'II', 'III', 'IV']
// A second path is held to its tiers I–III; tier IV is only ever a first path's.
export const SECOND_TIERS = 3

// A path's tiers, the ones held marked: its first `upto` (all four on a first path, three on a second);
// tier IV is a Knight's or a Marshal's.
export const pathTiers = (path, held = 0, upto = path.tiers.length) => h('ol', { class: 'tiers' }, path.tiers.slice(0, upto).map((t, i) =>
  h('li', { class: i < held ? 'held' : '' }, h('b', null, ROMAN[i]), ' ', t.desc, i === 3 && h('span', { class: 'tier-iv' }, ' Knight · Marshal'))))

function behaviourLine (role) {
  const r = ROLES[role]
  const b = BEHAVIOURS[r.move]
  const aims = r.move === 'stand' ? '' : ` Targets the ${r.target === 'weakest' ? 'foe with the lowest HP%' : 'nearest foe'} in reach.`
  return h('div', null, h('b', null, b.name), h('span', { class: 'dim' }, ` · ${b.desc}${aims}`))
}

// ── threat ───────────────────────────────────────────────────────────────────────────────────────

// Rough fighting power: √(HP × ATK × damage dealt × gauge rate), wounds included; a soul outside the
// Monarch's domain (and its Marshal's) counts at its faltering damage, so the meter answers where the Monarch stands. The
// ratio of the two sides tracks the basic autoplayer's win rate with the Monarch (200 seeded runs):
// below 0.6 every battle won, 0.6–0.8 98%, 0.8–1.0 79%, 1.0–1.2 42%, above 1.2 19%. That was measured
// before cohorts; the members on the board now count too (the reserve and held detachments do not), like souls.
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
// Nothing of yours on the board can strike (every soul benched or fallen): no ratio to read, and no win.
const UNFIELDED = { label: 'Deadly', cls: 't-dead', text: 'Nothing of yours on the field can strike, and the Monarch alone cannot win.' }

export function threat (run, node) {
  // The Monarch never strikes: only the souls and the members on the board count, at their faltering
  // damage outside its domain.
  const mods = partyMods(run)
  const mine = [...souls(boardField(run)), ...armyOf(run).members].reduce((n, u) => n + power(u, startsFaltering(run.state, u) ? [...mods, ...FALTERS] : mods), 0)
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
  return h('div', { class: `threat ${t.cls}` },
    h('div', { class: 'threat-head' }, h('span', { class: 'dim' }, 'Threat '), h('b', null, t.label),
      h('span', { class: 'dim' }, ` · ${t.text}`)),
    h('div', { class: 'threat-bar' }, h('span', { class: 'theirs', style: `width:${share * 100}%` })),
    t.rules.length > 0 && h('div', { class: 'warn small', tip: () => 'Their 8-step rules hold in the deep. They bend the battle in ways no stat shows, so the meter does not weigh them: read it as the low end.' },
      `Not counted: their ${t.rules.join(', ')}.`),
    h('div', { class: 'threat-legend dim' }, h('span', { tip: () => `Their foes' power: HP, ATK and speed at this floor's multipliers and their own formation's synergies.${t.waves.length > 1 ? ` Its waves (${t.waves.map(Math.round).join(', ')}) come one after another, so they add as the root of their squares: a second wave as strong as the first adds about 40%, not 100%.` : ''}` }, `Their power ${Math.round(t.theirs)}`),
      h('span', { tip: () => `Your fielded souls' power, and their cohorts' on the board: HP, ATK and speed, wounds included. Bodies outside the Monarch's domain count at their faltering damage (×${TUNING.monarch.falter}); the reserve, the detachments held behind the camp and the Monarch itself (it never strikes) add nothing.` }, `Your field ${Math.round(t.mine)}`)))
}

// ── rooms ────────────────────────────────────────────────────────────────────────────────────────

export const ROOM = {
  start: { name: 'Start', text: 'Where this floor begins.' },
  fight: { name: 'Fight', text: 'A battle. Win essence, the chance to recruit the souls you slew, and their bodies to bind.' },
  elite: { name: 'Elite', text: `A tougher battle, one tier stronger. Win essence, recruits, and 1 of ${TUNING.essence.eliteRelics} relics for free; from floor ${TUNING.keystone.fromFloor}, also 1 of ${TUNING.keystone.offer} keystones. On floor 1 a late pair joins it at ${secs(SP.late.t)}; from floor ${W.floor} it comes in ${W.elite} waves.` },
  reliquary: { name: 'Reliquary', text: `No battle. Choose 1 of 3 relics: lasting bonuses for the rest of the run. A retinue carries at most ${TUNING.essence.relicMax}: past that, reliquaries and elites offer none.` },
  rite: { name: 'Rite', text: `No battle. Choose 1 of 3 path tiers for your souls, for free; from floor ${TUNING.keystone.fromFloor}, also 1 of ${TUNING.keystone.offer} keystones.` },
  altar: { name: 'Altar', text: `No battle. Every soul and the Monarch heal to full; fallen souls rise at ${pct(TUNING.run.altarRevive)} HP, and the fallen rank-and-file stand again.` },
  boss: { name: 'The Hollow Sovereign', text: `The final battle, a siege: ${W.siege - 1} waves, then the Hollow Sovereign and its court. It grows stronger at 60% and 25% HP, and raises the dead. Kill it and its court crumbles: the run is cleared, and then you may descend into the deep.` },
  siege: { name: 'Siege', text: `One battle of ${W.siege} waves, with no prep between them: each enters at the far edge when the one before is down to ${shareText(W.share)}, or after ${secs(W.t)}. Each wave's essence is tallied as it falls and paid with the win. Win recruits and bodies to bind.` }
}

// ── the deep ─────────────────────────────────────────────────────────────────────────────────────

// The endless floors past the Sovereign's (TUNING.spawn.endless), in words: what descending means, how each
// floor deeper grows, and where a given floor stands.
const DEEP = TUNING.spawn.endless
const every = (k, what) => k >= 1 ? `${k} ${what} every floor deeper` : `one ${what} every ${+(1 / k).toFixed(1)} floors`
const perDeepWaves = every(DEEP.waves, 'more wave to every room')
const perDeepCohort = every(DEEP.cohort, 'more body behind every captain')
const perDeep = DEEP.count >= 1 ? `${DEEP.count} more foe${DEEP.count === 1 ? '' : 's'} a wave` : `one more foe a wave every ${+(1 / DEEP.count).toFixed(1)} floors`
export const DEEP_TEXT = {
  descend: `Slaying the Hollow Sovereign on floor ${TUNING.run.floors} clears the run, and the clear is yours for good. Then you may descend into the deep: the floors go on past it, each harder than the last, for as long as the Monarch lasts.`,
  growth: `The deep reuses floor ${TUNING.run.floors}'s camps and foes. ` + (DEEP.level
    ? `Every floor deeper adds ${DEEP.level} foe level${DEEP.level === 1 ? '' : 's'} on top of the usual ${TUNING.spawn.levelPerFloor} a floor, ${perDeep} (at most ${COLS * ROWS}), and +${pct(DEEP.hp)} HP and +${pct(DEEP.atk)} ATK. `
    : `Every floor deeper its foes rise the usual ${TUNING.spawn.levelPerFloor} levels and take +${pct(DEEP.hp)} HP and +${pct(DEEP.atk)} ATK, and there is ${perDeep} (at most ${COLS * ROWS}). `) +
    `Their army grows too: ${perDeepWaves} (up to ${DEEP.maxWaves}), and ${perDeepCohort}. ` +
    `From floor ${TUNING.run.floors + DEEP.rules} their synergies' 8-step rules hold for them as yours do for you (above it their steps stop at the numbers). ` +
    `Each deep floor ends in a big elite, not a boss: ${DEEP.final.count} more foes, ${DEEP.final.level} level${DEEP.final.level === 1 ? '' : 's'} higher. Then the next floor opens.`,
  fall: 'A fall in the deep ends the run like any defeat, but the clear stands.',
  // Where floor `floor` stands, for the top bar and the end screen.
  now: (floor) => {
    const d = depthOf(floor)
    const more = Math.floor(d * DEEP.count)
    const waves = Math.floor(d * DEEP.waves)
    const cohort = Math.floor(d * DEEP.cohort)
    const up = d * DEEP.level
    return `Floor ${floor} is ${d} floor${d === 1 ? '' : 's'} past the Sovereign's: its foes ${up ? `stand ${up} level${up === 1 ? '' : 's'} above the usual rise, ` : 'rise the usual levels, '}` +
      `${more ? `${more} more of them a wave, ` : ''}${waves ? `${waves} more wave${waves === 1 ? '' : 's'} to a room, ` : ''}${cohort ? `${cohort} more in every cohort, ` : ''}with ×${(1 + DEEP.hp * d).toFixed(2)} HP and ×${(1 + DEEP.atk * d).toFixed(2)} ATK.`
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

export function roomTip (run, node, { reachable }) {
  const r = ROOM[node.type]
  const kinds = node.foes && [...new Set(roomFoes(node).map((f) => unitDef(f.id).name))]
  return h('div', { class: 'room-tip' },
    h('div', { class: `rt-head t-${node.type}` }, icon(node.type === 'boss' ? 'boss' : node.type, 22), h('b', null, r.name)),
    h('p', null, r.text),
    node.type === 'altar' && holds(run.state, 'unhealable') && h('p', { class: 'warn' }, 'Court of Bone: the altar does not heal the Monarch.'),
    depthOf(run.state.floor) > 0 && node.type === 'elite' && node.next.length === 0 && h('p', { class: 'warn' }, `This floor's big elite: ${DEEP.final.count} more foes, ${DEEP.final.level} levels higher. Beyond it lies floor ${run.state.floor + 1}.`),
    node.foes && [
      h('div', { class: 'dim' }, `${foeCountText(node)} · level ${node.foes[0].lvl} · ${kinds.join(', ')}`),
      miniGrid(node.foes),
      captainLine(node.foes),
      foeSynergyLine(node.foes, run),
      // The waves to come, scouted like the first: who, where they stand, and when they come; never what they do.
      node.waves && h('div', { class: 'rt-waves' }, node.waves.map((w, k) => h('div', { class: 'rt-wave' },
        h('b', null, waveName(node, k)), miniGrid(w.foes, { small: true }), h('div', { class: 'dim small' }, waveWhen(w))))),
      threatMeter(run, node)],
    h('div', { class: 'rt-foot ' + (reachable ? 'go' : 'dim') }, reachable ? 'Click to enter.' : node.id === run.state.at ? 'You are here.' : 'Not reachable from here yet. Plan your route.'))
}

// Their synergies, short; `run` given, the 8-step rules only where the foes hold them (the deep: see
// TUNING.spawn.endless.rules), as the battle does.
export const foeRulesOn = (run) => depthOf(run.state.floor) >= TUNING.spawn.endless.rules
export function foeSynergyLine (foes, run = null) {
  const active = synergyNames(activeSynergies(foes).filter((syn) => !syn.rule || !run || foeRulesOn(run)))
  return h('div', { class: 'dim small' }, active.length ? ['Their synergies: ', active.map((n, i) => [i ? ' · ' : '', h('b', null, n)])] : 'They have no synergies.')
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

const COUNT_NOTE = 'Only fielded, standing souls and the cohort members on the board count (the Monarch never does); in battle, shadows count too.'

// The kins and roles you field, each with its steps (lit once reached, the rule step marked), then the pacts
// active or partway; each with a tooltip of every step and who counts. `units`: the field and the members.
// `alias`: your side's under Mimicry (aliasOf).
export function synergyTracker (units, alias = null) {
  const living = units.filter((u) => u.hp > 0)
  const c = countsOf(living, alias)
  const counts = (u, axis, id) => !ROLES[unitDef(u.id).role].hidden && (axis === 'role' ? rolesOf(unitDef(u.id), alias).includes(id) : unitDef(u.id)[axis] === id)
  const who = (axis, id) => tally(living.filter((u) => counts(u, axis, id)).map((u) => unitDef(u.id).name)) || 'none fielded'
  const mimicry = (axis, id) => alias && axis === 'role' && Object.values(alias).includes(id) && h('p', { class: 'dim' }, `Mimicry: ${Object.entries(alias).map(([a, b]) => `${ROLES[a].name}s count as ${ROLES[b].name}s`).join(', ')} too.`)
  const ladders = LADDERS.map((l) => ({ l, have: c[l.axis][l.id] ?? 0 })).filter((x) => x.have > 0)
    .map(({ l, have }) => ({ l, have, on: have >= l.steps[0].n, next: l.steps.find((st) => have < st.n) }))
  const pacts = PACTS.map((syn) => ({ syn, needs: needText(syn, c), on: synergyActive(syn, c) }))
    .filter((x) => x.on || x.needs.every((n) => n.have > 0))
  if (!ladders.length && !pacts.length) return h('p', { class: 'dim' }, 'None yet. Field two or more souls of one kin or role.')
  const ladderRow = ({ l, have, on, next }) => h('div', {
    class: 'syn' + (on ? ' on' : '') + (!next ? ' top' : ''),
    tip: () => h('div', { class: 'syn-tip' },
      h('b', null, `${l.name}: ${have} `), h('span', { class: 'dim' }, who(l.axis, l.id)),
      h('ol', { class: 'steps-list' }, l.steps.map(({ n, syn }) => h('li', { class: have >= n ? 'held' : '' },
        h('b', null, n), ' ', syn.rule ? [ruleTag(), ' ', h('b', null, ruleName(syn)), ': ', ruleText(syn)] : syn.desc))),
      h('p', { class: 'dim' }, `Steps stack: each one reached adds to those below it. ${next ? `${next.n - have} more ${l.name} for ${next.syn.name}.` : 'Every step is reached.'} ${COUNT_NOTE}`),
      l.steps.at(-1).syn.rule && h('p', { class: 'dim' }, 'A rule holds for whichever side reaches it: foes in the deep can hold one against you.'))
  },
  h('span', { class: 'syn-name' }, l.name,
    h('span', { class: 'syn-steps' }, l.steps.map(({ n, syn }) => h('i', { class: (have >= n ? 'held' : '') + (syn.rule ? ' rule' : '') }, n)))),
  h('span', { class: 'syn-prog' }, next ? `${have}/${next.n}` : `${have} · ${ruleName(l.steps.at(-1).syn)}`))
  const pactRow = ({ syn, needs, on }) => h('div', {
    class: 'syn' + (on ? ' on' : ''),
    tip: () => h('div', { class: 'syn-tip' },
      h('b', null, syn.name), h('p', null, syn.desc),
      needs.map((n) => h('div', null, `${n.name}: ${n.have} / ${n.n} `, h('span', { class: 'dim' }, who(n.axis, n.id)))),
      needs.map((n) => mimicry(n.axis, n.id)).find(Boolean),
      h('p', { class: 'dim' }, on ? 'Active: every fielded soul and every body of its cohorts gets this bonus.' : `Inactive. ${COUNT_NOTE}`))
  },
  h('span', { class: 'syn-name' }, syn.name),
  h('span', { class: 'syn-prog' }, needs.map((n, i) => [i ? ' + ' : '', `${Math.min(n.have, n.n)}/${n.n}`])))
  return h('div', { class: 'syns' },
    ladders.sort((a, b) => b.on - a.on || b.have - a.have).map(ladderRow),
    pacts.sort((a, b) => b.on - a.on).map(pactRow))
}

// Names with repeats counted: "Tomb Knight, Grave Ghoul ×3".
const tally = (names) => Object.entries(Object.groupBy(names, (n) => n)).map(([n, xs]) => (xs.length > 1 ? `${n} ×${xs.length}` : n)).join(', ')

// Active formation bonds, each with who holds it and with whom; the same bond between the same kinds (a
// cohort's members, say) is listed once, with how many hold it.
export function bondTracker (units, alias = null) {
  const held = activeBonds(units.filter((u) => u.hp > 0), { alias })
  const name = (uid) => unitDef(units.find((u) => u.uid === uid).id).name
  if (!held.length) return h('p', { class: 'dim' }, 'None. Souls bond with who stands beside, behind or ahead of them: see How to play (H).')
  const rows = Object.values(Object.groupBy(held, (b) => `${b.bond.id}|${name(b.uid)}|${name(b.partner)}`))
  return h('div', { class: 'syns' }, rows.map((bs) => {
    const b = bs[0]
    return h('div', {
      class: 'syn on',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, b.bond.name), h('p', null, b.bond.desc),
        h('p', { class: 'dim' }, `Held by ${bs.length > 1 ? `${bs.length} × ` : ''}${name(b.uid)}, thanks to ${name(b.partner)}. Bonds are set by the formation when the battle begins (a reserve body takes its own where it enters).`))
    }, h('span', { class: 'syn-name' }, '◆ ', b.bond.name), h('span', { class: 'syn-prog' }, `${name(b.uid)} · ${name(b.partner)}${bs.length > 1 ? ` ×${bs.length}` : ''}`))
  }))
}

// ── relics ────────────────────────────────────────────────────────────────────────────

// The moments a trigger relic fires on (TRIGGERS), for your side only, and what each counts.
export const TRIGGER_TEXT = {
  kill: { name: 'On a kill', when: 'one of yours (a soul, a body or a shadow) slays a foe. "The killer" is the one that struck the last blow.' },
  fall: { name: 'On a fall', when: 'one of yours falls: a soul, a body or a shadow, never the Monarch, whose fall ends the battle. A captain that rises by Undying still fell.' },
  enter: { name: 'On entry', when: 'one of yours enters the board from behind the camp: a body of your reserve, or a captain held back for a later start. A shadow rising by Arise is not an entry.' },
  struck: { name: 'When struck', when: 'the Monarch takes damage, a blow or a status ticking on it, and still stands. Blood Tithe\'s cost is not a blow.' }
}

export const relicTip = (id) => {
  const r = relicDef(id)
  return h('div', { class: 'syn-tip' }, h('b', null, r.name), r.on && h('div', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), h('p', null, r.desc),
    r.on && h('p', { class: 'dim' }, `It fires every time ${TRIGGER_TEXT[r.on].when} In battle its name flashes over the one it fired for.`),
    h('p', { class: 'dim' }, 'Relics last for the rest of the run.'))
}

// ── keystones ────────────────────────────────────────────────────────────────────────────────────

// What each keystone's rule covers beyond its one line (KEYSTONE_LIST holds the rule itself).
const KEYSTONE_MORE = {
  legion: 'Your souls, their cohorts\' bodies and your shadows fight at 75% of their max HP in battle; the Monarch keeps all of its own. The field takes 2 more souls (still at most the board\'s ' + TUNING.army.board + ').',
  undying: 'A captain (a soul on the field, never a body, a shadow or the Monarch) that falls rises at once on its own tile, its cohort still with it. Its second fall in a battle is final. Its first still counts as a fall: a detachment held for a body falling is called, and relics that fire when one of yours falls fire. Nothing ever revives the Monarch.',
  one_army: 'The banner pools its HP as the battle begins. A blow to any of its units comes out of the pool, and the pool is shared so each unit stands at the same share of its max HP: the whole banner falls together. Heals go into the pool, and a body entering joins it. A body whose captain fell leaves it.',
  mimicry: 'A Vanguard keeps its own role and counts as a Warden as well, for your synergies and your formation bonds. Your foes never mimic.',
  vanguard_crown: 'Faltering and Arise\'s reach measure from the captain nearest the foes (then the middle lane), and the domain moves with the front as it advances or falls. Reserve bodies and held detachments enter beside that captain, not the Monarch. With no captain standing it falls back on the Monarch.',
  hollow_court: 'Each of your shadows standing when a battle is won joins the ossuary as one standing body of its kind, fighting at the muster level from then on; its corpse is not offered to bind as well. Fallen shadows are gone. It keeps nothing of a battle fought before you took it.',
  blood_tithe: 'The tier limit is unchanged (1 + Will). The Monarch raises no shadow while its HP is at or below the cost, so the tithe never fells it, and the cost is not a blow.',
  court_of_bone: 'Nothing heals the Monarch: not healers, Regen, relics, the rest after a win, altars or a Monarch point (which still adds max HP). Your healers turn to others.'
}

export const keystoneTip = (id, run = null) => {
  const k = keystoneDef(id)
  const held = run?.state.keystones ?? []
  return h('div', { class: 'syn-tip' }, h('b', null, k.name), h('div', { class: 'ks-tag' }, 'Keystone'), h('p', null, k.desc), h('p', { class: 'dim' }, KEYSTONE_MORE[id]),
    h('p', { class: 'dim' }, `A keystone rewrites a rule for the rest of the run. You may hold ${TUNING.keystone.max}${run ? `; you hold ${held.length}${held.includes(id) ? ', this one among them' : ''}` : ''}.`))
}


// ── how to play ──────────────────────────────────────────────────────────────────────────────────

// Bodies in the ossuary, all kinds together: 'standing' or 'fallen'.
export const armyCount = (s, key) => Object.values(s.ossuary).reduce((n, o) => n + o[key], 0)

// run: the run in play, if any, so the rules can also say where you stand now.
export function helpOverlay (onClose, run = null) {
  const sec = (title, ...body) => h('section', null, h('h3', null, title), ...body)
  const m = TUNING.monarch
  const shown = ROLE_LIST.filter((r) => !r.hidden)
  const moves = [...new Set(shown.map((r) => r.move))].map((k) => BEHAVIOURS[k])
  const unhealable = run && holds(run.state, 'unhealable')
  const now = run && h('p', { class: 'dim' }, `Your Monarch now: ${MONARCH_STATS.map((k) => MONARCH_TEXT[k].now(run)).join(' · ')}; ${monarchPoints(run.state)} point${monarchPoints(run.state) === 1 ? '' : 's'} bought.`)
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal help', role: 'dialog', 'aria-label': 'How to play' },
      h('button', { class: 'icon-btn close', onclick: onClose, tip: () => 'Close (Esc)' }, icon('close')),
      h('h2', { class: 'modal-title' }, 'How to play'),
      h('p', { class: 'lede' }, 'You are the ', h('b', null, 'Monarch'), ', a necromancer who stands in its own camp and never strikes a blow. Your souls, and the rank-and-file they lead, fight on their own; ',
        `you win by choosing your route, who stands on the field, and where, yourself included, and what orders they carry in. Slay the Hollow Sovereign on floor ${TUNING.run.floors} to clear the run, then descend as deep as you dare. Hover anything in the game for exact numbers.`),
      h('div', { class: 'help-cols' },
        sec('1 · The route',
          h('p', null, 'Each floor is a map of rooms. You can only move up to a room connected to where you stand. ',
            'Hover any battle room to scout its foes, their formation, the waves behind them and the threat they pose.'),
          h('ul', { class: 'room-list' }, ['fight', 'elite', 'siege', 'reliquary', 'rite', 'altar', 'boss'].map((t) =>
            h('li', null, h('span', { class: `room-ico t-${t}` }, icon(t, 16)), h('b', null, ROOM[t].name), ' ', ROOM[t].text,
              t === 'altar' && unhealable && h('span', { class: 'warn' }, ' Court of Bone: not the Monarch.')))),
          h('p', null, h('b', null, 'The deep. '), DEEP_TEXT.descend, ' ', DEEP_TEXT.growth, ' ', h('b', { class: 'warn' }, DEEP_TEXT.fall)),
          run && depthOf(run.state.floor) > 0 && h('p', { class: 'dim' }, DEEP_TEXT.now(run.state.floor))),
        sec('2 · The Monarch',
          h('p', null, 'The Monarch is you. It stands in every battle on the camp cell you give it, never takes a step and never strikes. ',
            h('b', { class: 'warn' }, 'If it falls, the battle is lost, and so is the run'), ', however many souls still stand. If every soul falls while it stands, the battle goes on: it fights with its shadows.'),
          h('p', null, 'Its ', h('b', null, 'domain'), ` reaches ${m.domain} + Dominion tiles from it in every direction, diagonals counting as one: a square around its cell. Stood far enough forward, it runs past the camp's front onto the open ground and the foes' rows. `,
            'A soul outside it ', h('b', null, 'falters'), `: it deals ×${m.falter} damage while it stands there. The camp outlines the domain and marks the souls outside it. `,
            `A Marshal carries a small domain of its own for its banner (${TUNING.ranks.domain} tiles, outlined in its banner's colour): see Ranks. `,
            'Two keystones bend the Monarch\'s: Vanguard Crown centres it on your front-most captain, and Court of Bone widens it.'),
          h('p', null, 'Its one act is ', h('b', null, 'Arise'), ` (${abilityDef('arise').castCost} gauge): a fallen foe lying in the domain rises on your side as a `, h('b', null, 'shadow'),
            `, at its level with ${pct(m.raiseHp)} of its HP. Only foes of tier ${m.raiseTier} + Will or lower rise, at most ${m.raises} × (1 + Will) a battle (twice that with Blood Tithe), never a boss. `,
            `Shadows stand past the board's ${TUNING.army.board}, falter ${TUNING.monarch.shadowFalter ? 'wherever they stand' : 'outside the domain like any soul'} (one that rises within a Marshal's domain joins that Marshal's banner), count toward synergies, and are gone when the battle ends. With no corpse in reach, the Monarch banks its gauge.`),
          h('p', null, `It starts with ${m.hp} HP, and its wounds carry like a soul's. `, h('b', null, 'Monarch points'), ` cost ${m.cost} essence, ${m.costPerPoint} more for each one bought, and each adds ${m.hpPerPoint} max HP. Nothing else changes its stats: no synergy, relic or keystone (statuses and auras still reach it). Buy them in the camp, on the map or before a battle:`),
          h('ul', null,
            h('li', null, h('b', null, 'Dominion. '), '+1 tile of domain.'),
            h('li', null, h('b', null, 'Command. '), `+1 banner on the field (${TUNING.party.field} + Command on floor 1, ${TUNING.party.fieldPerFloor} more banner each floor down, at most ${TUNING.army.board}), and +1 body a cohort.`),
            h('li', null, h('b', null, 'Will. '), `Arise raises ${m.raises} more a battle, and one tier higher; one more body binds free after a win.`)),
          now),
        sec('3 · The army',
          h('p', null, ARMY_TEXT.cohort(run), ' Select a soul in the camp to give it one: the kind, how many, and the shape. ', h('b', null, 'Shapes:')),
          h('ul', null, Object.values(SHAPES).map((sh) => h('li', null, h('b', null, sh.name + '. '), sh.desc))),
          h('p', null, ARMY_TEXT.shapes, ' The camp shows the members ghosted on their cells, edged in their captain\'s colour. A soul may be placed on a member\'s cell: the member stands elsewhere.'),
          h('p', null, ARMY_TEXT.ai),
          h('p', null, h('b', null, 'The ossuary. '), ARMY_TEXT.ossuary),
          h('p', null, h('b', null, 'Binding. '), ARMY_TEXT.bind(run)),
          h('p', null, h('b', null, 'The muster. '), ARMY_TEXT.muster(run)),
          h('p', null, h('b', null, 'The board and the reserve. '), ARMY_TEXT.board),
          run && h('p', { class: 'dim' }, `Your ossuary now: ${armyCount(run.state, 'standing')} standing, ${armyCount(run.state, 'fallen')} fallen; muster level ${run.state.muster}.`)),
        sec('4 · Orders',
          h('p', null, ORDER_TEXT.detachments, ' ', ORDER_TEXT.pick),
          h('p', null, h('b', null, 'Where. ')),
          h('ul', null, Object.values(ORDERS.where).map((o) => h('li', null, h('b', null, o.name + '. '), o.desc))),
          h('p', null, 'Pick Move, then click any cell of the board for its square: your camp, the open ground, or their formation. The camp draws the square in the detachment\'s colour, with an arrow from it.'),
          h('p', null, h('b', null, 'When. ')),
          h('ul', null, Object.values(ORDERS.when).map((o) => h('li', null, h('b', null, o.name + '. '), o.desc))),
          h('p', null, ORDER_TEXT.held, ' ', ORDER_TEXT.wave),
          h('p', null, ORDER_TEXT.reaction),
          h('p', null, h('b', null, 'The domain\'s leash. '), ORDER_TEXT.leash),
          h('p', null, ORDER_TEXT.cohort, ' ', ORDER_TEXT.flank),
          h('p', { class: 'dim' }, 'In battle the plans are drawn faint under the units: each square, the arrow that shortens as they close on it (gone once they arrive), the ground a Stay holds, and a small mark on one that has stopped to fight.'),
          run && h('p', { class: 'dim' }, run.state.detachments.length
            ? `Your detachments now: ${run.state.detachments.map((d) => `${d.id}: ${planText(d.plan)}`).join(' · ')}.`
            : 'You have no detachments now: every soul Hunts, at once.')),
        sec('5 · The camp',
          h('p', null, `Up to ${TUNING.party.field} + Command souls${run ? ` (now ${fieldCap(run)})` : ''} stand in your `, h('b', null, 'camp'), ` with the Monarch, ${COLS}×${CAMP_ROWS} cells, each a captain with its cohort. The rest wait on the `, h('b', null, 'bench'),
            ', where they do not fight. Click a soul, then a cell or another soul, to move or swap them. The Monarch may stand on any open cell, but never on the bench.'),
          h('p', null, 'Each floor gives you a different camp. Its ', h('b', null, 'walls'), ' block walking, yours and theirs, but not attacks: bolts fly over them. ',
            `The foes always come from above: their formation, ${ROWS} rows deep, stands across ${TUNING.board.gap} row${TUNING.board.gap === 1 ? '' : 's'} of open ground from your camp, so the walls decide which way their melee has to walk.`),
          h('p', null, `Units walk one tile every ${secs(TUNING.board.stepTicks)}, whatever their speed, until a foe is in reach: melee reaches the 8 tiles around, a ranged ability its range in tiles. `,
            'Walking costs no gauge. Bodies block the way, friend or foe, for all but a flanker. A unit with a foe next to it is ', h('b', null, 'engaged'), ' and cannot walk away. ',
            'With nothing in reach it reacts (see Orders), then follows its plan; on Hunt, the default, each role moves its own way:'),
          h('table', { class: 'rows-table' },
            h('tr', null, h('th', null, 'Role'), h('th', null, 'Moves'), h('th', null, 'Targets')),
            shown.map((r) => h('tr', { tip: () => BEHAVIOURS[r.move].desc }, h('td', null, r.name), h('td', null, BEHAVIOURS[r.move].name), h('td', null, r.target === 'weakest' ? 'lowest HP%' : 'nearest')))),
          h('p', { class: 'dim' }, moves.map((b) => [h('b', null, b.name), ': ', b.desc, ' ']))),
        sec('6 · The battle',
          h('p', null, 'Once it begins you cannot act. Each unit fills its gold ', h('b', null, 'gauge'),
            ' by speed and acts when the gauge covers its next ability. It uses the first ability in its list whose condition holds and that has a target in reach, saving gauge for it. ',
            'Walking runs on its own common clock, off the gauge, so the gauge keeps filling on the march. ',
            'It banks only up to the unit\'s costliest ability: a unit kept waiting comes out with one big cast, not a string of them.'),
          h('p', null, h('b', null, 'Stats: '), 'ATK scales damage and healing. Damage taken is × 100 / (100 + DEF). SPD fills the gauge faster. ',
            `Hit chance is ACC / (ACC + EVA). CRT is the chance of a ×${TUNING.crit.mult} critical hit.`),
          h('p', null, h('b', null, 'Winning and losing: '), 'you win when every foe has fallen and none is still to come, or the moment the Hollow Sovereign falls. You lose the instant the Monarch falls. ',
            `A battle still undecided ${secs(TUNING.tick.ceiling)} after the last foe entered (after the start, if none has) is lost too. ${secs(TUNING.escalation.startTick)} after the start, or after the last entry (yours or theirs; ${secs(TUNING.escalation.startTick * TUNING.escalation.bossMult)} in the boss's room), all damage starts ramping up, +${pct(TUNING.escalation.perTick * 1000 / TUNING.tick.ms)} a second, up to ×${TUNING.escalation.max} (never later than ${secs(TUNING.escalation.startTick * TUNING.escalation.bossMult)} after the last foe entered), so few fights get that far. `,
            h('b', { class: 'warn' }, 'A lost battle ends the run.')),
          h('p', null, 'Space pauses, 1/2/4 change speed, S skips to the result: none of these change the outcome.')),
        sec('7 · Souls and essence',
          h('p', null, 'Every foe you slay pays ', h('b', null, 'essence'), ', more for stronger foes. After a win your standing souls and the Monarch heal ',
            `${pct(TUNING.run.postBattleHeal)} of their max HP; fallen souls and bodies stay down until an altar raises them. `,
            unhealable && h('b', { class: 'warn' }, 'You hold Court of Bone: nothing heals the Monarch, after a win, at an altar or anywhere else. '), 'Essence buys six things:'),
          h('ul', null,
            h('li', null, h('b', null, 'Levels. '), `Select a soul in your camp to buy its next level, up to ${TUNING.level.cap}. Nothing levels on its own.`),
            h('li', null, h('b', null, 'Paths. '), `Each kind of soul has two or three upgrade paths. Its first tier commits it to one; tiers II and III follow it (${TUNING.essence.tier.slice(0, 3).join(' / ')} essence). Third tiers change what a soul does. `,
              `Tier IV (${TUNING.essence.tier[3]}), a new rule rather than a percentage, and a second path are for Knights and Marshals: see Ranks.`),
            h('li', null, h('b', null, 'Recruits. '), 'After a win, the souls you slew are for sale, at the level they fought at. You may recruit one.'),
            h('li', null, h('b', null, 'Monarch points. '), 'Dominion, Command and Will: see The Monarch.'),
            h('li', null, h('b', null, 'The muster. '), 'One level for every rank-and-file body: see The army.'),
            h('li', null, h('b', null, 'Bodies. '), `After a win, the slain bound past the free ones, ${TUNING.army.bindPerTier} × tier each.`)),
          h('p', null, h('b', null, 'Your retinue is all you have: '), `you hold up to ${TUNING.party.roster} souls (${TUNING.party.roster + relicDef('ossuary_key').roster} with the ${relicDef('ossuary_key').name}), and only ${TUNING.party.field} + Command fight at once. `,
            'A full retinue must release a soul before it can recruit another. The Monarch counts toward neither.'),
          h('h3', null, 'Ranks'),
          // Kept short: the rank panel and its tooltips carry the rest (RANK_TEXT.promote), and the README the drawing.
          h('p', null, `Feed a soul standing bodies of its kin from the ossuary (its rank panel in the camp): ${RK.knight} make a Soldier a Knight, ${RK.marshal} more a Knight a Marshal. `,
            'Free bodies go first, and are gone for good. No essence.'),
          h('ul', { class: 'rank-list' }, GRADES.map((g, i) => h('li', null, h('span', { class: `rank-ins g${i}` }, icon(GRADE_ICON[i], 14)), h('b', null, g.name + '. '),
            [g.desc, ' ', ['', `Not both until it is a Marshal. Tier IV costs ${TUNING.essence.tier[3]}.`,
              `Its domain reaches ${RK.domain} tiles and moves with it; it never falters itself.`][i]]))),
          h('p', { class: 'dim' }, RANK_TEXT.second)),
        h('section', { class: 'wide' }, h('h3', null, '8 · Synergies'),
          h('p', null, 'Field souls that share a kin or role to unlock bonuses for the whole field. Each kin and role has ', h('b', null, 'steps'), ' at 2, 4, 6 and 8 of them (Ranger at 3, 6 and 8), and they stack: ',
            'Undead 6 has Undead 2 and 4 as well. Cohort members and shadows count while they stand on the board, so a captain and its cohort can reach the deep steps alone; the Monarch never counts.'),
          h('div', { class: 'syn-table flow' }, LADDERS.map((l) => h('div', null, h('b', null, l.name),
            h('span', { class: 'dim' }, ' ' + l.steps.filter((st) => !st.syn.rule).map((st) => `${st.n}: ${st.syn.desc}`).join(' · '))))),
          h('h3', null, 'The eights: rules'),
          h('p', null, 'A ladder\'s top step is a ', h('b', null, 'rule'), ', not a number: it changes what happens in battle, and the battle names it when it strikes. ',
            'A rule holds for whichever side reaches it: deep down, foes can hold one against you, with "yours" and "foes" swapped.'),
          h('div', { class: 'syn-table flow' }, LADDERS.map((l) => l.steps.at(-1).syn).filter((syn) => syn.rule).map((syn) =>
            h('div', null, ruleTag(), ' ', h('b', null, `${syn.name}: ${ruleName(syn)}.`), h('span', { class: 'dim' }, ' ' + sentence(ruleText(syn)))))),
          h('h3', null, 'Pacts'),
          h('p', null, 'A kin and a role together.'),
          h('div', { class: 'syn-table flow' }, PACTS.map((s) => h('div', null, h('b', null, s.name), h('span', { class: 'dim' }, ' ' + s.desc)))),
          h('h3', null, 'Bonds'),
          h('p', null, 'Set by the formation when a battle begins, and kept all battle: a soul bonds with the one beside it in its row, or right behind or ahead of it in its lane. ',
            'A member holds the bonds of its cell, a reserve body those of where it enters, a shadow those of where it rises. The Monarch neither holds nor gives one. ', h('b', null, '◆'), ' marks a bonded soul in prep.'),
          h('div', { class: 'syn-table' }, BONDS.map((b) => h('div', null, h('b', null, b.name), h('span', { class: 'dim' }, ' ' + b.desc)))),
          h('h3', null, 'Auras and area attacks'),
          h('p', null, 'Some souls lend an ', h('b', null, 'aura'), ' to allies near them while they stand, so packing close pays. ',
            'Area attacks punish it: a ', h('b', null, 'blast'), ' hits its target and everyone next to it, and aims wherever its targets stand thickest.')),
        h('section', { class: 'wide' }, h('h3', null, '9 · Relics'),
          h('p', null, 'Reliquaries and elites offer relics, free, for the rest of the run. Some are flat bonuses or change prices; most are ', h('b', null, 'triggers'),
            ', firing in battle at one of four moments, for your side only (their name flashes over the one they fired for):'),
          h('ul', null, TRIGGERS.map((on) => h('li', null, h('b', null, `${TRIGGER_TEXT[on].name}: `), `when ${TRIGGER_TEXT[on].when}`))),
          h('div', { class: 'syn-table flow' }, RELIC_LIST.map((r) => h('div', null, h('b', null, r.name), r.on && h('span', { class: 'trig-tag' }, TRIGGER_TEXT[r.on].name), h('span', { class: 'dim' }, ' ' + r.desc)))),
          run && h('p', { class: 'dim' }, run.state.relics.length ? `Yours: ${run.state.relics.map((id) => relicDef(id).name).join(', ')}.` : 'You hold none yet.')),
        sec('10 · Keystones',
          h('p', null, `A keystone rewrites one rule for the rest of the run. From floor ${TUNING.keystone.fromFloor}, a won elite and a rite each offer ${TUNING.keystone.offer} you do not hold, beside their relics or path tiers: take one, free. `,
            `A run holds at most ${TUNING.keystone.max}, and a build is how they combine. None of them ever revives the Monarch.`),
          h('div', { class: 'syn-table' }, KEYSTONE_LIST.map((k) => h('div', { tip: () => keystoneTip(k.id, run) }, h('b', null, k.name), h('span', { class: 'dim' }, ' ' + k.desc)))),
          run && h('p', { class: 'dim' }, run.state.keystones.length ? `Yours: ${run.state.keystones.map((id) => keystoneDef(id).name).join(', ')} (${run.state.keystones.length} of ${TUNING.keystone.max}).` : `You hold none yet (at most ${TUNING.keystone.max}).`)),
        sec('11 · The enemy army',
          h('p', null, 'The foes grow the way your army does, floor by floor. What you scout of a room is who comes, where they stand and when: never what they mean to do.'),
          h('ul', null,
            h('li', null, h('b', null, 'The late pair. '), ENEMY_TEXT.late),
            h('li', null, h('b', null, 'Captains and cohorts. '), ENEMY_TEXT.captains, ' The scouted formation marks each captain with its cohort\'s size.'),
            h('li', null, h('b', null, 'Orders. '), ENEMY_TEXT.orders),
            h('li', null, h('b', null, 'Waves. '), ENEMY_TEXT.waves),
            h('li', null, h('b', null, 'Sieges. '), ENEMY_TEXT.siege),
            h('li', null, h('b', null, 'The Sovereign\'s court. '), ENEMY_TEXT.court())),
          h('p', null, ENEMY_TEXT.entry, ' ', h('b', null, 'Depth'), ' is the threat they pose: more foes arriving behind the first, onto a line that has walked out of the domain. When a later wave fells the Monarch, the defeat screen says which wave it came with.'))),
      h('p', { class: 'dim center-text' }, 'Press ', h('kbd', null, 'H'), ' anywhere to open this again.')))
  return el
}
