// The content kinds core declares, and what "valid" means for each (§12).
//
// This is code, not content: it is the *shape* of a unit, not any unit. Shipping the 100th unit
// touches only packs/. Adding a whole new kind (say `mount`) is a mod registering one entry here
// through the same door.
//
// Every kind lists its outbound references so the loader can prove there are no dangling ids
// before the first tick (invariant §18.4) — a missing ability fails at boot with a name, not on
// floor 7 with a TypeError.

import { TARGET_MODES, RECRUIT_ACTIONS } from '../doctrine.js'
import { EDITABLE } from '../tenet.js'

/** Every legal modifier path (§11.3). A typo becomes a boot error naming the pack. */
export const STAT_PATHS = [
  'hp', 'atk', 'def', 'spd', 'acc', 'eva', 'crt', 'charm',
  'gauge.rate', 'gauge.cost',
  'persuade.threshold', 'persuade.chance',
  'damage.dealt', 'damage.taken', 'heal.given', 'heal.taken',
  'residue.mult', 'loot.mult', 'xp.mult', 'coin.mult'
]

/** Ability shapes read directly off the 3×4 grid (§3) — this is where the tactics come from. */
export const SHAPES = ['single', 'column', 'row', 'adjacent', 'all', 'slot', 'self', 'ally', 'all_allies']

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const num = (v) => typeof v === 'number' && Number.isFinite(v)

function checkStatBlock (block, where, required) {
  const errs = []
  if (!isObj(block)) return [`${where} must be an object`]
  for (const k of required) if (!num(block[k])) errs.push(`${where}.${k} must be a number`)
  for (const k of Object.keys(block)) {
    if (k !== '_note' && !num(block[k])) errs.push(`${where}.${k} must be a number`)
  }
  return errs
}

function checkModifiers (def, api, where = 'modifiers') {
  const errs = []
  for (const [i, m] of (def.modifiers ?? []).entries()) {
    errs.push(...api.statSchema.check([{ ...m, src: def.id }]).map((e) => `${where}[${i}]: ${e}`))
  }
  return errs
}

/**
 * Declarative hook rows — the shape that makes an item, a status, a Resonance, a Pact, a keystone,
 * a shrine curse and a Lattice node one type (§11.5). A row nudges one field of one proposal:
 *
 *   { "point": "damage:compute", "prio": 50, "field": "mul", "op": "mul", "v": 0.8,
 *     "when": ["eq", ["row", "$target"], 0] }
 */
function checkHookRows (def, api) {
  const errs = []
  for (const [i, h] of (def.hooks ?? []).entries()) {
    const where = `hooks[${i}]`
    if (!isObj(h)) { errs.push(`${where} must be an object`); continue }
    if (!api.hookPoints[h.point]) { errs.push(`${where}: unknown hook point "${h.point}"`); continue }
    const mutable = api.hookPoints[h.point]
    if (!mutable.includes(h.field)) {
      errs.push(`${where}: field "${h.field}" is not mutable at ${h.point} (allowed: ${mutable.join(', ') || 'none'})`)
    }
    if (!['set', 'add', 'mul'].includes(h.op)) errs.push(`${where}: op must be set, add or mul`)
    if (h.op !== 'set' && !num(h.v)) errs.push(`${where}: v must be a number for ${h.op}`)
    if (h.prio !== undefined && !num(h.prio)) errs.push(`${where}: prio must be a number`)
    if (h.when) errs.push(...api.forms.validate(h.when, `${where}.when`))
  }
  return errs
}

function checkExpr (expr, api, where) {
  return expr === undefined ? [] : api.forms.validate(expr, where)
}

/**
 * One definition, two content kinds. `{when, modifiers[], hooks[]}` is also the shape an item, a
 * keystone, a shrine curse and a Lattice node will register with (§11.5) — each of those is this
 * function plus a different activation trigger.
 */
function synergyKind (withDeps) {
  return {
    refs: [],
    validate: (def, raw) => {
      const api = withDeps(raw)
      const errs = []
      if (typeof def.name !== 'string') errs.push('name is required')
      if (def.when === undefined) errs.push('when is required — a synergy with no threshold is always on')
      errs.push(...checkExpr(def.when, api, 'when'))
      errs.push(...checkModifiers(def, api))
      errs.push(...checkHookRows(def, api))
      if ((def.modifiers ?? []).length === 0 && (def.hooks ?? []).length === 0) {
        errs.push('has neither modifiers nor hooks, so it can never do anything')
      }
      return errs
    }
  }
}

/**
 * @param {{statSchema: object}} deps
 * @returns {object} kind → {refs, validate}
 */
export function contentKinds (deps) {
  const withDeps = (api) => ({ ...api, ...deps })

  return {
    // ── taxonomy ────────────────────────────────────────────────────────────────────────────
    kin: {
      refs: [],
      validate: (def) => (typeof def.name === 'string' ? [] : ['name is required'])
    },
    role: {
      refs: [],
      validate: (def) => (typeof def.name === 'string' ? [] : ['name is required'])
    },
    element: {
      // Affinity lives on the attacking element, so a mod adding an element declares its own
      // matchups instead of patching a global matrix nobody owns. Its refs are the *keys* of an
      // object rather than values at a path, so they are checked below rather than declared here.
      refs: [],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        for (const [k, v] of Object.entries(def.affinity ?? {})) {
          if (!num(v)) errs.push(`affinity["${k}"] must be a number`)
          if (!api.registry.has('element', k)) errs.push(`affinity names unknown element "${k}"`)
        }
        return errs
      }
    },

    // ── tuning: every constant in §2 and §5, as one reviewable, patchable file ───────────────
    tuning: {
      refs: [],
      validate: (def) => {
        const errs = []
        for (const path of ['hit.min', 'hit.max', 'crit.min', 'crit.max', 'crit.mult', 'crit.divisor',
          'damage.atkDivisor', 'damage.defConstant', 'damage.min', 'tick.hz', 'persuade.decay',
          'persuade.max', 'persuade.charmDivisor', 'persuade.weakenBonus',
          // Every constant a system reads is checked here, because the alternative is a TypeError
          // on floor 7 in a patched pack rather than a boot error naming the file.
          'spawn.levelPerFloor', 'spawn.tierPerFloor', 'spawn.tierMax', 'spawn.tierOverCap',
          'spawn.tierFalloff', 'spawn.bossEvery',
          'residue.floorBase', 'residue.floorGrowth', 'residue.coherenceBonus',
          'coin.perFoeTier', 'coin.perFloor', 'coin.treasure', 'insight.divisor']) {
          const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), def)
          if (!num(v)) errs.push(`${path} must be a number`)
        }
        if (!Array.isArray(def.variance) || def.variance.length !== 2) errs.push('variance must be [lo, hi]')
        if (!isObj(def.rows)) errs.push('rows must be an object keyed by row index')
        return errs
      }
    },

    // ── statuses, and the one shape every buff-like thing shares ────────────────────────────
    status: {
      refs: [{ path: 'element', kind: 'element' }],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        if (def.dur !== undefined && !num(def.dur) && def.dur !== 'battle' && def.dur !== 'run') {
          errs.push('dur must be a number of ticks, "battle" or "run"')
        }
        if (def.stacks !== undefined && !Number.isInteger(def.stacks)) errs.push('stacks must be an integer')
        if (def.tickEvery !== undefined && (!Number.isInteger(def.tickEvery) || def.tickEvery < 1)) {
          errs.push('tickEvery must be a positive whole number of ticks')
        }
        errs.push(...checkModifiers(def, api))
        errs.push(...checkHookRows(def, api))
        for (const [i, e] of (def.tick ?? []).entries()) errs.push(...api.ops.validate(e, `tick[${i}]`))
        return errs
      }
    },

    // ── abilities: a when gate, a shape, and an ordered list of ops. Never code. ─────────────
    ability: {
      refs: [
        { path: 'element', kind: 'element' },
        { path: 'effects[].element', kind: 'element' },
        { path: 'effects[].status', kind: 'status' },
        { path: 'anim', kind: 'anim_template' }
      ],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        if (!num(def.castCost) || def.castCost <= 0) errs.push('castCost must be a positive number')
        if (!SHAPES.includes(def.shape)) errs.push(`shape must be one of ${SHAPES.join(' ')}`)
        if (def.shape === 'slot' && !Number.isInteger(def.slot)) errs.push('shape "slot" needs an integer slot')
        if (def.melee !== undefined && typeof def.melee !== 'boolean') errs.push('melee must be a boolean')
        if (!Array.isArray(def.effects) || def.effects.length === 0) errs.push('effects must be a non-empty array')
        for (const [i, e] of (def.effects ?? []).entries()) errs.push(...api.ops.validate(e, `effects[${i}]`))
        errs.push(...checkExpr(def.when, api, 'when'))
        return errs
      }
    },

    // ── units ───────────────────────────────────────────────────────────────────────────────
    unit: {
      refs: [
        { path: 'kin', kind: 'kin' },
        { path: 'role', kind: 'role' },
        { path: 'element', kind: 'element' },
        { path: 'abilities[]', kind: 'ability' },
        { path: 'branches[].opts[]', kind: 'branch' },
        { path: 'phases[].grant', kind: 'status' },
        { path: 'art.descriptor', kind: 'art_descriptor' },
        { path: 'art.attackTemplate', kind: 'anim_template' }
      ],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        if (!Number.isInteger(def.tier) || def.tier < 1) errs.push('tier must be an integer ≥ 1')
        errs.push(...checkStatBlock(def.base, 'base', ['hp', 'atk', 'def', 'spd', 'acc', 'eva', 'crt']))
        errs.push(...checkStatBlock(def.growth ?? {}, 'growth', []))
        if (!Array.isArray(def.abilities) || def.abilities.length === 0) errs.push('abilities must be a non-empty array')
        if (!isObj(def.art) || typeof def.art.descriptor !== 'string') {
          // art.descriptor, not art.sheet: the sheet is generated from a descriptor (§15), so
          // adding a unit never means commissioning art.
          errs.push('art.descriptor is required')
        }
        for (const [i, b] of (def.branches ?? []).entries()) {
          if (!Number.isInteger(b?.at)) errs.push(`branches[${i}].at must be an integer level`)
          if (!Array.isArray(b?.opts) || b.opts.length < 2) errs.push(`branches[${i}].opts needs at least 2 choices`)
        }

        // A boss is a unit def with a flag, not a new kind (§6.3) — one slot, no formation, and
        // three things the flag turns on. Every one of them is a data row, so a boss mechanic costs
        // no code and a pack's boss is indistinguishable from ours.
        if (def.boss !== undefined && typeof def.boss !== 'boolean') errs.push('boss must be a boolean')
        if (def.persuadable !== undefined && typeof def.persuadable !== 'boolean') {
          errs.push('persuadable must be a boolean')
        }
        for (const [i, p] of (def.phases ?? []).entries()) {
          // Fractions, not HP: a phase at "300 hp" would move every time the unit is rebalanced or
          // levelled, and a boss's thresholds are a statement about the shape of the fight.
          if (!num(p?.at) || p.at <= 0 || p.at > 1) errs.push(`phases[${i}].at must be an HP fraction in (0, 1]`)
          if (typeof p?.grant !== 'string') errs.push(`phases[${i}].grant must name a status`)
        }
        if ((def.phases ?? []).some((p, i) => i > 0 && p.at >= def.phases[i - 1].at)) {
          errs.push('phases must be ordered by descending HP fraction — the fight only goes one way')
        }

        if (def.spawn?.weight !== undefined && !(num(def.spawn.weight) && def.spawn.weight >= 0)) {
          errs.push('spawn.weight must be a number ≥ 0')
        }
        if (def.spawn?.floors !== undefined &&
          (!Array.isArray(def.spawn.floors) || def.spawn.floors.length !== 2 || !def.spawn.floors.every(Number.isInteger))) {
          errs.push('spawn.floors must be [first, last] integers')
        }
        errs.push(...checkExpr(def.spawn?.when, api, 'spawn.when'))
        return errs
      }
    },

    // ── spawn tables (§6.2). A floor-scoped pool; matching tables sum, so no load order can
    //    change what a floor fields (§18.6).
    spawn: {
      refs: [{ path: 'weights[].unit', kind: 'unit' }],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        if (!Array.isArray(def.floors) || def.floors.length !== 2 || !def.floors.every(Number.isInteger)) {
          errs.push('floors must be [first, last] integers')
        } else if (def.floors[0] > def.floors[1]) {
          errs.push(`floors [${def.floors}] is empty — first is deeper than last`)
        }
        if (def.units !== undefined && def.units !== '*') errs.push('units may only be "*"')
        if (def.units === undefined && !(def.weights ?? []).length) {
          errs.push('a table with neither units:"*" nor weights[] can never spawn anything')
        }
        errs.push(...checkExpr(def.when, api, 'when'))
        for (const [i, row] of (def.weights ?? []).entries()) {
          if (row.w !== undefined && !(num(row.w) && row.w >= 0)) errs.push(`weights[${i}].w must be a number ≥ 0`)
          errs.push(...checkExpr(row.when, api, `weights[${i}].when`))
        }
        return errs
      }
    },

    // ── per-unit progression choices (§3), one branch = modifiers + hooks + maybe an ability ──
    branch: {
      refs: [{ path: 'grants[]', kind: 'ability' }],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = typeof def.name === 'string' ? [] : ['name is required']
        errs.push(...checkModifiers(def, api))
        errs.push(...checkHookRows(def, api))
        return errs
      }
    },

    // ── synergy (§3). Resonance and Pact are the SAME shape validated by the SAME function and
    //    activated by the SAME walk in synergy.js. If these two ever diverge, the M2 gate has
    //    broken and a mod's Pact stops being a first-class citizen.
    resonance: synergyKind(withDeps),
    pact: synergyKind(withDeps),

    // ── art source (§15). Shared across the roster; a unit's cost is one rig id and one
    //    ~40-line descriptor. The sim never reads any of this — the baker and renderer do.
    art_rig: {
      refs: [],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (!Array.isArray(def.size) || def.size.length !== 2) errs.push('size must be [w, h]')
        if (!Array.isArray(def.origin) || def.origin.length !== 2) errs.push('origin must be [x, y]')
        if (!isObj(def.joints)) return errs.concat('joints must be an object')
        for (const [name, j] of Object.entries(def.joints)) {
          if (j.parent !== null && !def.joints[j.parent]) errs.push(`joint "${name}" has unknown parent "${j.parent}"`)
          if (!Array.isArray(j.at) || j.at.length !== 2) errs.push(`joint "${name}".at must be [x, y]`)
        }
        for (const name of def.z ?? []) if (!def.joints[name]) errs.push(`z names unknown joint "${name}"`)
        for (const [key, id] of Object.entries(def.clips ?? {})) {
          if (!api.registry.has('art_clip', id)) errs.push(`clips.${key} → unknown art_clip "${id}"`)
        }
        return errs
      }
    },
    art_clip: {
      refs: [],
      validate: (def) => {
        const errs = []
        if (!num(def.fps) || def.fps <= 0) errs.push('fps must be positive')
        if (!Number.isInteger(def.frames) || def.frames < 1) errs.push('frames must be a positive integer')
        for (const [joint, tracks] of Object.entries(def.tracks ?? {})) {
          for (const [ch, arr] of Object.entries(tracks)) {
            if (!['x', 'y', 'rot', 'scale'].includes(ch)) errs.push(`tracks.${joint}.${ch} is not a channel (x, y, rot, scale)`)
            if (!Array.isArray(arr) || arr.some((v) => !num(v))) errs.push(`tracks.${joint}.${ch} must be an array of numbers`)
            else if (arr.length !== def.frames) errs.push(`tracks.${joint}.${ch} has ${arr.length} keys but the clip has ${def.frames} frames`)
          }
        }
        return errs
      }
    },
    art_part: {
      refs: [],
      validate: (def) => {
        const errs = []
        if (!Array.isArray(def.shapes)) return ['shapes must be an array']
        for (const [i, s] of def.shapes.entries()) {
          if (!['ellipse', 'rect', 'capsule', 'poly'].includes(s?.type)) {
            errs.push(`shapes[${i}].type must be ellipse, rect, capsule or poly`)
          }
          if (s?.fill !== undefined && !/^(ramp|accent)\.[0-9]+$/.test(s.fill)) {
            errs.push(`shapes[${i}].fill must be a palette slot like "ramp.2" — never a raw colour`)
          }
        }
        return errs
      }
    },
    art_palette: {
      refs: [],
      validate: (def) => {
        if (!Array.isArray(def.ramp) || def.ramp.length < 2) return ['ramp must be an array of at least 2 colours']
        return def.ramp.filter((c) => !/^#[0-9a-fA-F]{6}$/.test(c)).map((c) => `ramp colour ${JSON.stringify(c)} must be #rrggbb`)
      }
    },
    art_descriptor: {
      refs: [{ path: 'rig', kind: 'art_rig' }, { path: 'tiles[].shape', kind: 'art_part' }],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        for (const which of ['ramp', 'accent']) {
          const id = def.palette?.[which]
          if (id && !api.registry.has('art_palette', id)) errs.push(`palette.${which} → unknown art_palette "${id}"`)
        }
        if (def.type === 'tileset') {
          if (!Array.isArray(def.tiles) || def.tiles.length === 0) errs.push('a tileset descriptor needs tiles[]')
          return errs
        }
        if (!def.palette?.ramp) errs.push('palette.ramp is required')
        const rig = def.rig && api.registry.has('art_rig', def.rig) ? api.registry.get('art_rig', def.rig) : null
        for (const [joint, bind] of Object.entries(def.parts ?? {})) {
          if (rig && !rig.joints[joint]) errs.push(`parts."${joint}" is not a joint of ${def.rig}`)
          if (rig && !(rig.z ?? []).includes(joint)) errs.push(`parts."${joint}" is not in ${def.rig}'s z order, so it would never draw`)
          if (!api.registry.has('art_part', bind?.shape)) errs.push(`parts."${joint}".shape → unknown art_part "${bind?.shape}"`)
          if (bind?.held && !api.registry.has('art_part', bind.held)) errs.push(`parts."${joint}".held → unknown art_part "${bind.held}"`)
        }
        for (const [key, id] of Object.entries(def.overrides?.clips ?? {})) {
          if (!api.registry.has('art_clip', id)) errs.push(`overrides.clips.${key} → unknown art_clip "${id}"`)
        }
        return errs
      }
    },

    // ── the two kinds §4 is made of ─────────────────────────────────────────────────────────
    //
    // A **tenet** is one small named thing the player buys with Codex, and the sum of the ones they
    // own is the whole of what they can say. A **dispatch** reports something that happened and
    // stops. Both are content, which is the claim §4.1 rests on: a pack ships either exactly as it
    // ships a Pact, and because `when` is the same evaluator as everything else, neither needs a
    // line of UI work.
    tenet: {
      refs: [{ path: 'requires[]', kind: 'tenet' }],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.name !== 'string') errs.push('name is required')
        if (typeof def.desc !== 'string') errs.push('desc is required — an unexplained purchase is not a choice')
        if (!Number.isInteger(def.cost) || def.cost < 1) {
          // Priced in Codex, which is a count of discoveries and deliberately not farmable (§5).
          // A free tenet is one the player never decided to have, which is the whole thing this
          // kind exists to stop.
          errs.push('cost must be a whole number of Codex, at least 1')
        }
        if (def.order !== undefined && !num(def.order)) errs.push('order must be a number')

        const g = def.grants
        if (!isObj(g)) return errs.concat('grants is required — a tenet that grants nothing is a price tag')
        for (const path of g.edit ?? []) {
          if (!EDITABLE.includes(path)) errs.push(`grants.edit names "${path}", which is not an editable Doctrine path`)
        }
        for (const [path, n] of Object.entries(g.slots ?? {})) {
          if (!EDITABLE.includes(path)) errs.push(`grants.slots names "${path}", which is not an editable Doctrine path`)
          if (!Number.isInteger(n) || n < 1) errs.push(`grants.slots.${path} must be a positive integer`)
        }
        for (const name of g.forms ?? []) {
          if (!api.forms.has(name)) errs.push(`grants.forms names unknown expr form "${name}"`)
        }
        for (const group of g.groups ?? []) {
          if (!api.forms.list().some((f) => f.group === group)) errs.push(`grants.groups names "${group}", which no form belongs to`)
        }
        for (const id of g.modes ?? []) {
          if (!TARGET_MODES.some((m) => m.id === id)) errs.push(`grants.modes names unknown targeting mode "${id}"`)
        }
        for (const id of g.actions ?? []) {
          if (!RECRUIT_ACTIONS.some((a) => a.id === id)) errs.push(`grants.actions names unknown action "${id}"`)
        }
        if (!(g.edit ?? []).length && !Object.keys(g.slots ?? {}).length && !(g.forms ?? []).length &&
            !(g.groups ?? []).length && !(g.modes ?? []).length && !(g.actions ?? []).length) {
          errs.push('grants is empty, so buying this would change nothing')
        }
        return errs
      }
    },

    dispatch: {
      refs: [],
      validate: (def, raw) => {
        const api = withDeps(raw)
        const errs = []
        if (typeof def.title !== 'string') errs.push('title is required — it is the sentence the player reads')
        if (typeof def.body !== 'string') errs.push('body is required')
        if (def.when === undefined) errs.push('when is required — a dispatch with no trigger fires forever')
        // ★ The one place in the game where the ledger forms are legal (§11.6). Everywhere else the
        // same call is a validation error, which is what keeps combat independent of save history.
        errs.push(...(def.when === undefined ? [] : api.forms.validate(def.when, 'when', 'dispatch')))
        if (def.once !== undefined && !['run', 'profile', 'never'].includes(def.once)) {
          // The whole cooldown model, and it is three words: a dispatch that can fire twice a run
          // is a dispatch that will (§4.1).
          errs.push('once must be "run", "profile" or "never"')
        }
        if (def.prio !== undefined && !num(def.prio)) errs.push('prio must be a number')
        // Deliberately no `offers`. A dispatch reports what happened; what to do about it is the
        // player's to deduce and the player's to buy. If this kind ever grows an answer field, the
        // thing being rebuilt is the Precedent, and §4.1 records why that was the wrong shape.
        if (def.offers !== undefined) {
          errs.push('a dispatch has no offers — it reports what happened; the response is the player\'s (§4.1)')
        }
        return errs
      }
    },

    // ── presentation: consumed by the renderer only, never by the sim (§7) ──────────────────
    anim_template: {
      refs: [],
      validate: (def) => {
        const errs = []
        if (!num(def.dur)) errs.push('dur must be a number of milliseconds')
        if (!Array.isArray(def.steps)) errs.push('steps must be an array')
        for (const [i, s] of (def.steps ?? []).entries()) {
          if (!num(s?.t)) errs.push(`steps[${i}].t must be a number`)
          if (typeof s?.op !== 'string') errs.push(`steps[${i}].op must be a string`)
        }
        return errs
      }
    }
  }
}
