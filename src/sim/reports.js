// The autoplayer's runners and reports, printed by autoplay.js: a run recorded (record), the worker pool (playAll), the
// balance report, paired comparisons, the ladder, decisions, ablations and necessity, the builds harness, the pool table.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRng } from './rng.js'
import {
  tracksOf, CAMP_SLOTS, campOpen, makeUnit, baseStats, sizeOf, footprintSlots, fits, monarchSlot, cellsOf, statsOf
} from './unit.js'
import { createBattle, playOut, timelineHash, fork, order, stalled } from './turns.js'
import { outForestModel, useOutForest } from './outforest.js'
import { grantsArise } from './rules.js'
import { useSolverHook, useFormationHook, forgetPrepped, solve } from './solver.js'
import {
  createRun, fieldCap, fielded, currentNode, battleSetup, isMonarch, monarchOf, souls, soulCount, levelOf, firstLevel,
  monarchHp, ariseOf, spawnPool, captainPool, draftOffer, drawRoom, varyRoutes, ascensionTop, bossPool, bossIn,
  BASE_MONARCH
} from './run.js'
import { nodeOf, RANKS, generateFloor } from './map.js'
import { pool as workerPool } from './pool.js'
import * as SEQ from './sequential.js'
import { TUNING } from '../tuning.js'
import { unitDef, campDef, relicDef, FUSION_LIST, UNIT_LIST, SYNERGIES } from '../content.js'
import {
  LEVELS, TURNS, turnsOf, ablatedTurns, ABLATIONS, RULE_SWITCHES, ablatedRun, asMonarch, monarchText, legendary,
  basicCells, hpPct, byFieldPower, shippedRoute, routeModel, useRoute, standing, AUDIT, resetAudit, FEATURES, chose,
  gives, ARCHETYPES, synergyOf, commitOf, withCommit, autoplay
} from './player.js'

// ── playing many runs ─────────────────────────────────────────────────────────────────────────────

// Of a battle's army (your pieces that took the board, not the Monarch, not shadows): how many, and how many acted.
export function armyMeasures (b) {
  const mine = (uid) => {
    const u = b.byUid.get(uid)
    return !!u && u.side === 'party' && !u.shadow && u !== b.monarch
  }
  const army = new Set()
  const acted = new Set()
  for (const e of b.events) {
    if (e.type === 'battle:start') for (const u of e.units) if (mine(u.uid)) army.add(u.uid)
    if (e.type === 'action' && mine(e.actor)) acted.add(e.actor)
  }
  return { army: army.size, acted: [...army].filter((uid) => acted.has(uid)).length }
}

// A run's build, as the ladder reads it: its Legendaries, the kin most of its fielded souls share, their kinds' tracks.
const legendariesOf = (s) => s.relics.filter(legendary)
const buildOf = (s) => {
  const kins = {}
  for (const u of fielded(souls(s.party))) kins[unitDef(u.id).kin] = (kins[unitDef(u.id).kin] ?? 0) + 1
  const kin = Object.entries(kins).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? '-'
  const tracks = [...new Set(fielded(souls(s.party)).flatMap((u) => tracksOf(u.id).filter((_, i) => u.tracks[i] > 0).map((t) => t.id)))].sort()
  return { legendaries: legendariesOf(s).sort().join('+') || '-', kin, tracks: tracks.join('+') || '-' }
}

// One seeded run at `level` as the reports need it (`ablate`: one mechanic taken away). A job may name its players, each
// in use for the run alone: `route` ('hand', 'learned' or a file), `outforest` (a file, or 'none'); `act`, a player in
// place of the level's policy. The record:
//   battles      each as the retinue entered it: floor, boss, t, stall, won, lvl, size, roster, foes, relics, raised,
//                pieces, fell, summoned, waves, foesIn, colossi, syn, lead, army, acted, camp, purse (the essence
//                unspent as it began), room and rank (its room's type and rank), mhp and mend (the Monarch's share of
//                its max HP as it began and ended), solve (its first solve's stats: solved, level, plans, turns,
//                margin, prep, truncated, sharp), solves (how many), prep (the formation's: index fielded, candidates
//                solved, those won), probe (probeOf: weaker play from its opening), keys, keysLocked and locks (the
//                keys your side's blows spent, of those the ones that opened a lock (a key of that foe's lock spent on
//                it; the rest were paid with no lock to open), and the locked foes that stood), sentries (the foes that held their tile); with `setups` its
//                setup, with `snapshots` its snapshot and outcome (for refights)
//   result, floor, camp, relics, reaped, death   how it ended
//   monarch      its max HP, Command and Arise copies, and Arise's reach and tier
//   legendaries, build, ossuary   what it held at the end (buildOf)
//   acts, tiers  its actions by type; its kinds' track tiers at the end
//   progress, fell   how far it got (progressOf), and where it fell (null for a clear)
//   commit, scale, ascension, variant   the archetype it was committed to, the foes' scale, its level, its Monarch
//   built, end   what it made (builtOf) and its margin (endOf)
//   secs         wall time, the only field that is not a pure function of the job
//   outforest    the forests out of battle that played it (null for none)
export function record ({ route, outforest, ...job }) {
  return withOutForest(outforest, () => withRoute(route, () => recordRun(job)))
}
function recordRun ({ seed, level, ablate = null, setups = false, snapshots = false, scale = 1, ascension = 0, monarch = BASE_MONARCH, act = null }) {
  const battles = []
  const t0 = Date.now()
  forgetPrepped()
  const run = ablatedRun(seed, ablate, null, { scale, ascension, monarch })
  const L = { ...LEVELS[level], ...(ablate && { ablate }) }
  let snap = null
  let purse = 0
  let mhp = 1
  // The solves of the battle under way, and the formation chosen for it (the prep comes before the fight).
  let solves = []
  let probe = null
  let prepNow = null
  let prep = null
  const offSolver = useSolverHook(({ stats }, b) => {
    if (!solves.length) probe = probeOf(b)
    solves.push(stats)
  })
  const offFormation = useFormationHook(({ index, stats }) => { prepNow = { index, n: stats.length, won: stats.filter((x) => x.won).length } })
  // The battle the run fell in: its room's rank and the share of its foes' HP removed.
  let fell = null
  try {
    autoplay(run, {
      level: L,
      act,
      beforeFight: (r) => {
        purse = r.state.essence
        const m = monarchOf(r.state)
        mhp = m.maxHp > 0 ? Math.max(0, m.hp) / m.maxHp : 0
        solves = []
        probe = null
        prep = prepNow
        prepNow = null
        if (snapshots) snap = structuredClone({ ...r.state, log: [] })
      },
      onBattle: (b, r) => {
        const node = currentNode(r)
        const s0 = solves[0]
        const m = b.monarch
        if (b.winner !== 'party') fell = { rank: currentNode(r).rank, share: foeShare(b) }
        const party = b.units.filter((u) => u.side === 'party' && !u.shadow && u !== b.monarch)
        battles.push({
          floor: b.floor + (b.boss ? 'B' : ''),
          ...(b.boss && { boss: bossIn(currentNode(r)) }),
          t: b.turn,
          stall: b.reason === 'stall',
          won: b.winner === 'party',
          lvl: party.reduce((n, u) => n + u.lvl, 0) / Math.max(1, party.length),
          size: party.length,
          roster: soulCount(r.state.party),
          foes: b.units.filter((u) => u.side === 'foe').length,
          relics: r.state.relics.length,
          raised: b.raised,
          pieces: party.length,
          fell: party.filter((u) => u.hp <= 0).length,
          summoned: b.units.filter((u) => u.summoned).length,
          waves: b.events.filter((e) => e.type === 'wave').length,
          foesIn: b.events.filter((e) => e.type === 'enter' && e.unit.side === 'foe').length,
          keys: b.events.filter((e) => e.type === 'key' && b.byUid.get(e.actor)?.side === 'party').length,
          keysLocked: b.events.filter((e) => e.type === 'key' && b.byUid.get(e.actor)?.side === 'party' && unitDef(b.byUid.get(e.target)?.id)?.lock?.keys.includes(e.status)).length,
          locks: b.units.filter((u) => u.side === 'foe' && !u.shadow && unitDef(u.id)?.lock).length,
          sentries: b.units.filter((u) => u.side === 'foe' && !u.shadow && unitDef(u.id)?.hold).length,
          colossi: r.setup.party.filter((u) => u.uid !== 0 && sizeOf(u) === 2).length,
          syn: synergiesAt(b),
          lead: leadOf(r.setup.party.filter((u) => u.uid !== 0)),
          ...armyMeasures(b),
          camp: r.state.camp,
          purse,
          room: node.type,
          rank: node.rank,
          mhp: +mhp.toFixed(3),
          mend: m ? +(Math.max(0, m.hp) / m.maxHp).toFixed(3) : null,
          solve: s0 ? { solved: s0.solved, level: s0.level, plans: s0.plans, turns: s0.turns, margin: s0.margin, prep: !!s0.prep, truncated: s0.truncated, sharp: s0.sharp } : null,
          solves: solves.length,
          prep,
          probe,
          setup: setups ? r.setup : undefined,
          snapshot: snapshots ? snap : undefined,
          outcome: snapshots ? { won: b.winner === 'party', t: b.turn, hash: timelineHash(b.events), turns: turnsOf(L) } : undefined
        })
        prep = null
      }
    })
  } finally {
    offSolver()
    offFormation()
  }
  const s = run.state
  return {
    battles, result: s.result, floor: s.floor, camp: s.camp, relics: s.relics.length, reaped: s.stats.reaped,
    monarch: { maxHp: monarchOf(s).maxHp, command: fieldCap(run), copies: s.relics.filter(grantsArise).length, ...ariseOf(s) }, death: s.death, legendaries: legendariesOf(s), build: buildOf(s),
    ossuary: souls(s.party).filter((u) => u.slot < 0).length,
    acts: s.log.reduce((n, a) => ({ ...n, [a.type]: (n[a.type] ?? 0) + 1 }), {}),
    tiers: souls(s.party).reduce((n, u) => n + u.tracks[0] + u.tracks[1], 0),
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    fell,
    commit: commitOf(),
    ...(scale !== 1 && { scale }),
    ...(ascension && { ascension }),
    ...(monarch !== BASE_MONARCH && { variant: monarch }),
    built: builtOf(run),
    end: endOf(run, battles),
    secs: (Date.now() - t0) / 1000,
    outforest: outForestModel()?.name ?? null
  }
}

// How a battle goes for weaker play than the solver's, from its opening board `b` (never touched): `idle` End Turn
// alone (what is left untouched strikes with its basics), `greedy` the solver one option, one plan and one board wide
// (PROBE plans at most). Each { won, m (the Monarch's share of its max HP at the end), t (rounds played) }.
const PROBE = 1500
export function probeOf (b) {
  const end = (g) => ({ won: g.over && g.winner === 'party', m: g.monarch ? +(Math.max(0, g.monarch.hp) / g.monarch.maxHp).toFixed(3) : null, t: g.turn - b.turn + 1 })
  const f = fork(b)
  while (!f.over && !stalled(f)) order(f, { type: 'end' })
  const g = solve(b, { widths: [[1, 1, 1]], budget: PROBE, cap: Infinity, slack: false })
  return { idle: end(f), greedy: end(g.end) }
}

// The model a job names: its file's (read once a worker), none for 'none' or null, or the configuration itself.
const MODELS = new Map()
export function modelOf (spec) {
  if (spec === 'none' || spec === null) return null
  if (typeof spec === 'object') return spec
  if (!MODELS.has(spec)) MODELS.set(spec, JSON.parse(fs.readFileSync(spec, 'utf8')))
  return MODELS.get(spec)
}
// `fn()` with the forests out of battle `spec` names in use (modelOf; undefined: whatever is), then the one before.
export function withOutForest (spec, fn) {
  if (spec === undefined) return fn()
  const before = outForestModel()
  useOutForest(modelOf(spec))
  try {
    return fn()
  } finally {
    useOutForest(before)
  }
}
// The same for the route: 'hand' the hand-built, 'learned' the shipped one (src/sim/route.json), else a route file's.
const routeFiles = new Map()
export function withRoute (spec, fn) {
  if (spec === undefined) return fn()
  const before = routeModel()
  if (spec === 'hand') useRoute(false)
  else if (spec === 'learned') useRoute(shippedRoute())
  else {
    if (!routeFiles.has(spec)) routeFiles.set(spec, JSON.parse(fs.readFileSync(spec, 'utf8')))
    useRoute(routeFiles.get(spec))
  }
  try {
    return fn()
  } finally {
    useRoute(before ?? false)
  }
}
// The player a paired comparison names: 'none' (the player as it ships), `route:<hand|learned|file>` or
// `outforest:<file|none>`. → the job's {}, { route } or { outforest }
export function playerOf (spec) {
  if (spec === 'none') return {}
  const route = String(spec).match(/^route:(.+)$/)
  if (route) return { route: route[1] }
  const out = String(spec).match(/^outforest:(.+)$/)
  if (out) return { outforest: out[1] }
  throw new Error(`a player "${spec}": none, route:<hand|learned|file> or outforest:<file|none>`)
}

// One seeded run with the audit on (AUDIT): what its plans considered and chose; per battle, Arise's raises and synergies.
export function auditRecord ({ seed, level, ascension = 0, monarch = BASE_MONARCH }) {
  const t0 = Date.now()
  const battles = { n: 0, won: 0, raised: 0, synergies: 0 }
  forgetPrepped()
  const run = createRun({ seed, ascension, monarch })
  resetAudit(true, run)
  autoplay(run, {
    level,
    beforeFight: (r) => chose(r.state, fielded(r.state.party)),
    onBattle: (b) => {
      battles.n++
      battles.won += b.winner === 'party'
      battles.raised += b.raised
      battles.synergies += b.events[0]?.synergies.filter((x) => x.side === 'party').length ?? 0
    }
  })
  const s = run.state
  const acts = {}
  for (const a of s.log) {
    acts[a.type] = (acts[a.type] ?? 0) + 1
  }
  const out = {
    seed, level, ...(ascension && { ascension }), ...(monarch !== BASE_MONARCH && { variant: monarch }), result: s.result, floor: s.floor, secs: (Date.now() - t0) / 1000, battles, acts,
    candidates: AUDIT.candidates, plans: AUDIT.plans, considered: AUDIT.considered, chosen: AUDIT.chosen, done: AUDIT.done, rules: AUDIT.rules,
    example: AUDIT.example
  }
  resetAudit(false)
  return out
}

// The audit (--audit): `runs` expert runs and one basic, per mechanic how often their plans considered it and chose it.
export async function audit ({ runs, seed: seed0, ascension = 0, monarch = null }) {
  const t0 = Date.now()
  const at = { ...(ascension && { ascension }), ...asMonarch(monarch) }
  const jobs = [...Array.from({ length: runs }, (_, k) => ({ seed: `${seed0}-${k + 1}`, level: 'expert', audit: true, ...at })), { seed: `${seed0}-1`, level: 'basic', audit: true, ...at }]
  const played = await playAll(jobs)
  const groups = [['expert', played.filter((r) => r.level === 'expert')], ['basic', played.filter((r) => r.level === 'basic')]]
  const sum = (rs, f) => rs.reduce((n, r) => n + (f(r) ?? 0), 0)
  console.log(`audit: ${runs} expert run(s) (seeds ${seed0}-1…${runs}${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}) and one basic, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  for (const [level, rs] of groups) {
    console.log(`  ${level}: ${rs.map((r) => `${r.seed} ${r.result ?? 'over'} floor ${r.floor}, ${r.battles.n} battles, ${r.secs.toFixed(0)} s`).join('; ')}`)
  }
  const row = (name, considered, chosen) => console.log(`${name.padEnd(34)}${groups.map(([, rs]) => `${String(considered(rs)).padStart(11)}${String(chosen(rs)).padStart(9)}`).join('   ')}`)
  console.log(`\n${''.padEnd(34)}${groups.map(([l]) => `${l.padStart(11)} ${''.padStart(8)}`).join('   ')}`)
  console.log(`${'mechanic'.padEnd(34)}${groups.map(() => `${'considered'.padStart(11)}${'chosen'.padStart(9)}`).join('   ')}`)
  row('formations (met/fought)', (rs) => sum(rs, (r) => r.candidates), (rs) => sum(rs, (r) => r.plans))
  for (const f of FEATURES) row(f, (rs) => sum(rs, (r) => r.considered[f]), (rs) => sum(rs, (r) => r.chosen[f]))
  const fusions = (book) => (r) => Object.entries(r[book]).reduce((n, [k, v]) => n + (k.startsWith('fuse ') ? v : 0), 0)
  row('fuse (weighed/done)', (rs) => sum(rs, fusions('considered')), (rs) => sum(rs, (r) => r.acts.fuse))
  row('recruit (weighed/done)', (rs) => sum(rs, (r) => r.considered.recruit), (rs) => sum(rs, (r) => r.done.recruit))
  row('release (done)', () => '-', (rs) => sum(rs, (r) => r.acts.release))
  row('relic bought (done)', () => '-', (rs) => sum(rs, (r) => r.acts.buy))
  row('relic given (weighed/done)', (rs) => sum(rs, (r) => r.considered.hold), (rs) => sum(rs, (r) => r.acts.hold))
  row('upgrade (weighed/bought)', (rs) => sum(rs, (r) => r.considered.upgrade), (rs) => sum(rs, (r) => r.done.upgrade))
  // The rule of the tree that decided each decision (or the weights), with the first one's situation.
  const experts = groups[0][1]
  const rules = {}
  for (const r of experts) for (const [k, n] of Object.entries(r.rules)) rules[k] = (rules[k] ?? 0) + n
  console.log('\nthe expert\'s decisions, by the rule that decided them (the weights where none did), and the first one\'s situation:')
  for (const [k, n] of Object.entries(rules).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    console.log(`  ${k.padEnd(32)} ${String(n).padStart(7)}  ${experts.map((r) => r.example[k]).find(Boolean) ?? ''}`)
  }
  console.log('\nfought, per level:')
  for (const [level, rs] of groups) {
    const n = Math.max(1, sum(rs, (r) => r.battles.n))
    console.log(`  ${level}: Arise ${(sum(rs, (r) => r.battles.raised) / n).toFixed(2)} raises and ${(sum(rs, (r) => r.battles.synergies) / n).toFixed(2)} synergies a battle; ${sum(rs, (r) => r.battles.won)}/${n} won`)
  }
}

// How far a run got, 0 to 1: the rooms completed of the route to the Sovereign, the battle it fell in counted by the
// share of its foes' HP removed (`rank` its room's, `share` in [0, 1]). 1 for a clear.
export const ROOMS_PER_FLOOR = RANKS - 1
export const routeRooms = () => ROOMS_PER_FLOOR * TUNING.run.floors
// The run's floors, 1 to TUNING.run.floors: the reports' columns of deaths by floor.
const FLOORS = () => Array.from({ length: TUNING.run.floors }, (_, f) => f + 1)
export function progressOf ({ result, floor, rank = 1, share = 0 }) {
  if (result === 'victory') return 1
  const done = (floor - 1) * ROOMS_PER_FLOOR + (rank - 1) + Math.min(1, Math.max(0, share))
  return Math.min(1, Math.max(0, done / routeRooms()))
}
// The share of a battle's foe HP removed, the reserve's waves counted whole at the HP they enter with (the side's mods:
// the floor's and the boss's scale), shadows left out.
export function foeShare (b) {
  let hp = 0
  let max = 0
  for (const u of b.units) {
    if (u.side !== 'foe' || u.shadow) continue
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  for (const u of b.reserve) {
    const whole = Math.max(1, Math.round(statsOf({ id: u.id, lvl: u.lvl, tracks: u.tracks }, b.foeMods ?? []).hp))
    hp += whole
    max += whole
  }
  return max ? 1 - hp / max : 0
}

// Plays every job in worker threads (WORKERS, else one per core), the longest first (jobTime). → the results in the
// jobs' order; with `cache`, a job it holds is read, each played kept. Where a job runs changes no result.
let WORKERS = null
// The run cache the reports read and fill: the command line's, unless --no-cache; none for a caller of the exports.
let CACHE = null
export function configure ({ workers, cache } = {}) {
  if (workers !== undefined) WORKERS = workers
  if (cache !== undefined) CACHE = cache
}
async function playAll (jobs, { cache = null } = {}) {
  const { availableParallelism } = await import('node:os')
  const times = loadTimes()
  const out = new Array(jobs.length)
  // With a cache, each job's key; a job it holds read; of jobs alike (one key), the first played and the rest its copies.
  const keys = cache ? jobs.map((job) => cache.key(job)) : null
  const first = new Map()
  if (cache) jobs.forEach((_, i) => { out[i] = first.has(keys[i]) ? null : cache.get(keys[i]) ?? undefined; if (!first.has(keys[i])) first.set(keys[i], i) })
  const queue = [...jobs.keys()].filter((i) => out[i] === undefined).sort((a, b) => jobTime(jobs[b], times) - jobTime(jobs[a], times) || a - b)
  // The workers run autoplay.js, whose command-line block is a pool worker's entry.
  await workerPool(new URL('./autoplay.js', import.meta.url), { pool: true }, queue.map((i) => jobs[i]), WORKERS ?? availableParallelism(), (k, result, ms) => {
    const i = queue[k]
    times[jobKey(jobs[i])] = ms / 1000
    out[i] = cache ? cache.put(keys[i], result) : result
  })
  saveTimes(times)
  if (cache) jobs.forEach((_, i) => { if (out[i] === null) out[i] = structuredClone(out[first.get(keys[i])]) })
  return out
}

// How long each job took when last played here, in seconds: a file in the OS's temp directory, read only to order jobs.
const TIMES = 'retinue-job-times.json'
const timeKey = (job) => job.refight ? null : `${job.seed}|${job.level}|${job.ablate ?? ''}${job.route ? `|route:${job.route}` : ''}${job.outforest ? `|outforest:${job.outforest}` : ''}${job.ascension ? `|a${job.ascension}` : ''}${job.monarch ? `|m:${job.monarch}` : ''}`
function loadTimes () {
  try {
    return JSON.parse(fs.readFileSync(path.join(os.tmpdir(), TIMES), 'utf8'))
  } catch { return {} }
}
function saveTimes (times) {
  delete times.null
  try { fs.writeFileSync(path.join(os.tmpdir(), TIMES), JSON.stringify(times)) } catch {}
}
// A job's expected length: its last time if known, else a guess by its player and level.
const jobTime = (job, times) => times[jobKey(job)] ?? (job.refight || job.level === 'basic' ? 1 : job.player === 'teacher' ? 67 : job.ablate ? 4 : 5)

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints the clear rate, battle length, per-floor progression and each camp's record.
export async function report ({ runs, seed: seed0, level, ablate = null, ascension = 0, monarch = null, out = null }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, ablate, ...(ascension && { ascension }), ...asMonarch(monarch) })), { cache: CACHE })
  if (out) fs.writeFileSync(out, JSON.stringify({ seed: seed0, level, ablate, ascension, runs, records: played.map((r, i) => ({ seed: `${seed0}-${i}`, ...r })) }) + '\n')
  const battles = played.flatMap((r) => r.battles)
  const turns = battles.map((b) => b.t).sort((a, b) => a - b)
  const deaths = {}
  const floors = {} // floor (B = boss) → sums at the start of each battle there
  const camps = {} // camp id → { battles, won, ended: runs lost in it }
  for (const b of battles) {
    const f = (floors[b.floor] ??= { n: 0, lvl: 0, size: 0, roster: 0, foes: 0, relics: 0, won: 0 })
    f.n++
    for (const k of ['lvl', 'size', 'roster', 'foes', 'relics', 'won']) f[k] += b[k]
    const c = (camps[b.camp] ??= { battles: 0, won: 0, ended: 0 })
    c.battles++
    c.won += b.won
  }
  for (const r of played) {
    if (r.result === 'defeat') camps[r.camp].ended++
    if (r.result !== 'victory') deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
  }
  const sum = (key) => played.reduce((n, r) => n + r[key], 0)
  const q = (p) => turns[Math.min(turns.length - 1, Math.floor(p * turns.length))]
  const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
  console.log(`runs ${runs} (seed ${seed0}, ${level} player${ablate ? `, ${ablate} ablated` : ''}${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)})`)
  console.log(`clear rate        ${pct(played.filter((r) => r.result === 'victory').length)}`)
  for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
  console.log(`battles           ${turns.length}, ${(turns.length / runs).toFixed(1)} per run`)
  console.log(`battle turns      median ${q(0.5)}, p90 ${q(0.9)}, max ${turns.at(-1)}, stalls ${battles.filter((b) => b.stall).length}`)
  console.log(`mean souls reaped ${(sum('reaped') / runs).toFixed(2)}`)
  console.log('\nper floor, averaged over battles fought there (retinue as it entered the battle):')
  console.log('floor  battles  won    field lvl  fielded  roster  foes  relics')
  for (const [k, f] of Object.entries(floors)) {
    const avg = (v, d = 1) => (v / f.n).toFixed(d)
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ${pct(f.won * runs / f.n).padStart(5)}  ${avg(f.lvl).padStart(9)}  ${avg(f.size).padStart(7)}  ${avg(f.roster).padStart(6)}  ${avg(f.foes).padStart(4)}  ${avg(f.relics).padStart(6)}`)
  }
  console.log('\nper camp (battles fought in it; runs that ended there in defeat):')
  console.log('floor  camp               battles  won     defeats')
  for (const [id, c] of Object.entries(camps).sort((a, b) => campDef(a[0]).floor - campDef(b[0]).floor || a[0].localeCompare(b[0]))) {
    console.log(`${String(campDef(id).floor).padEnd(5)}  ${campDef(id).name.padEnd(17)}  ${String(c.battles).padStart(7)}  ${(100 * c.won / c.battles).toFixed(1).padStart(5)}%  ${String(c.ended).padStart(7)}`)
  }
}

// ── two players on the same seeds ────────────────────────────────────────────────────────────────

// Two players' runs, seed for seed: each one's clears, progress (points), battles won and fought, deaths by floor and
// seconds a run; and B against A, the clears won and lost and the progress difference ± one standard error.
// → { runs, a, b, won, lost, diff, se }
export function pairedStats (A, B) {
  const side = (R) => {
    const battles = R.flatMap((r) => r.battles)
    const deaths = {}
    for (const r of R) if (r.result !== 'victory') deaths[r.floor] = (deaths[r.floor] ?? 0) + 1
    return {
      clears: R.filter((r) => r.result === 'victory').length,
      progress: 100 * R.reduce((n, r) => n + r.progress, 0) / Math.max(1, R.length),
      battles: battles.length,
      won: battles.filter((b) => b.won).length,
      deaths,
      secs: R.reduce((n, r) => n + r.secs, 0) / Math.max(1, R.length)
    }
  }
  const n = Math.min(A.length, B.length)
  const d = Array.from({ length: n }, (_, i) => 100 * (B[i].progress - A[i].progress))
  const diff = d.reduce((x, y) => x + y, 0) / Math.max(1, n)
  const se = n > 1 ? Math.sqrt(d.reduce((x, y) => x + (y - diff) ** 2, 0) / (n - 1) / n) : 0
  const cleared = (r) => r.result === 'victory'
  return {
    runs: n,
    a: side(A.slice(0, n)),
    b: side(B.slice(0, n)),
    won: A.slice(0, n).filter((r, i) => !cleared(r) && cleared(B[i])).length,
    lost: A.slice(0, n).filter((r, i) => cleared(r) && !cleared(B[i])).length,
    diff,
    se
  }
}

// The same seeds played by players a and b (playerOf), and their paired report; `sequential`: stopped once decided.
export async function paired (o) {
  if (o.sequential) return pairedSequential(o)
  const { runs, seed: seed0 } = o
  const all = await playAll(pairedJobs(o, 0, runs), { cache: CACHE })
  const S = pairedStats(all.slice(0, runs), all.slice(runs))
  const seeds = Array.from({ length: runs }, (_, i) => `${seed0}-${i}`)
  if (o.out) fs.writeFileSync(o.out, JSON.stringify({ seed: seed0, players: o.players, runs, a: all.slice(0, runs).map((r, i) => ({ seed: seeds[i], ...r })), b: all.slice(runs).map((r, i) => ({ seed: seeds[i], ...r })) }) + '\n')
  for (const line of pairedLines(S, o, `${runs} seeds ${seed0}-0…${seed0}-${runs - 1}`)) console.log(line)
  return S
}
// The jobs of a paired comparison: seeds `from`…`to` − 1 played by a, then the same by b.
const pairedJobs = ({ seed, level, players, ascension = 0, monarch = null }, from, to) => players.flatMap((spec) =>
  Array.from({ length: to - from }, (_, i) => ({ seed: `${seed}-${from + i}`, level, ...playerOf(spec), ...(ascension && { ascension }), ...asMonarch(monarch) })))
// A paired report as lines (pairedStats' S): the header naming `seeds`, a row a player, b against a.
function pairedLines (S, { level, players: [a, b], ascension = 0, monarch = null }, seeds, how = '') {
  const pct = (k, of = S.runs) => `${(100 * k / Math.max(1, of)).toFixed(1)}%`
  const floors = [...new Set([...Object.keys(S.a.deaths), ...Object.keys(S.b.deaths)])].sort()
  const out = [`paired${how}: ${seeds}, ${level} player${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}; a = ${a}, b = ${b}`]
  out.push('      clears   progress  battles won        ' + floors.map((f) => `died fl ${f}`.padStart(10)).join('') + '  s/run')
  for (const [k, x] of [['a', S.a], ['b', S.b]]) {
    out.push(`${k}     ${pct(x.clears).padStart(6)}  ${x.progress.toFixed(1).padStart(9)}  ${`${pct(x.won, x.battles)} (${x.won}/${x.battles})`.padStart(19)}` +
      floors.map((f) => String(x.deaths[f] ?? 0).padStart(10)).join('') + `  ${x.secs.toFixed(2).padStart(5)}`)
  }
  out.push(`b against a: clears won ${S.won}, lost ${S.lost} (net ${S.won - S.lost >= 0 ? '+' : ''}${S.won - S.lost}); ` +
    `progress ${S.diff >= 0 ? '+' : ''}${S.diff.toFixed(2)} ± ${S.se.toFixed(2)} points (one standard error of the paired difference)`)
  return out
}
// --paired --sequential: seeds in blocks of `block`, a and b on each, a look after each (SEQ.look, decide), stopped at
// the first decided, else at `runs`. → pairedStats' S with { stop, plan }
async function pairedSequential (o) {
  const { runs, seed: seed0, block = 64, design = 'peto', alpha = 0.05, minGain = SEQ.MIN_GAIN } = o
  const p = SEQ.plan({ runs, block, design, alpha })
  const A = []
  const B = []
  let stop = null
  console.log(`paired, sequential: at most ${runs} seeds ${seed0}-0…, blocks of ${block}; ${SEQ.DESIGN_NAMES[design]}, two-sided α ${alpha}; futile below ${minGain >= 0 ? '+' : ''}${minGain} points`)
  for (let k = 0; !stop || stop.decision === 'continue'; k++) {
    const n = p.looks[k] - A.length
    const all = await playAll(pairedJobs(o, A.length, p.looks[k]), { cache: CACHE })
    A.push(...all.slice(0, n))
    B.push(...all.slice(n))
    const s = SEQ.look(A, B)
    stop = { k, ...s, ...SEQ.decide(s, k, p, { minGain }) }
    console.log(SEQ.lookLine(stop, p))
  }
  const S = pairedStats(A, B)
  for (const line of pairedLines(S, o, `${A.length} of at most ${runs} seeds ${seed0}-0…${seed0}-${A.length - 1}`, ', sequential')) console.log(line)
  console.log(SEQ.stopLine(stop, p, { minGain }))
  return { ...S, stop, plan: p }
}

// ── skill ladder ─────────────────────────────────────────────────────────────────────────────────

// What ended a run, one cause per defeat: the killer's first threat, 'overrun' for a battle lost with nothing of yours
// but the Monarch standing, or 'stall' for one played past the sim's bound.
export const causesOf = (death) => !death ? [] : [death.reason === 'stall' || death.reason === 'overrun' ? death.reason : death.threat ?? 'none']

// The ladder's rungs, the weakest first:
//   basic     rules of thumb (LEVELS.basic)
//   expert    LEVELS.expert
export const RUNGS = Object.freeze(['basic', 'expert'])

// The ascension levels a --ascension names: `all`, a comma-separated list, or one; each checked.
export function ascensionsOf (spec = '0') {
  if (spec === 'all') return Array.from({ length: ascensionTop() + 1 }, (_, k) => k)
  const out = String(spec).split(',').filter((x) => x !== '').map(Number)
  for (const a of out) if (!(Number.isInteger(a) && a >= 0 && a <= ascensionTop())) throw new Error(`ascension "${a}": a level from 0 to ${ascensionTop()}, a list of them, or all`)
  if (!out.length) throw new Error('--ascension: a level, a list of them, or all')
  return out
}

// One run of the ladder: seed `seed` played by rung `player` at level `ascension`. → a promise of the record
export async function ladderRecord ({ seed, player, ascension = 0, monarch = BASE_MONARCH }) {
  if (!RUNGS.includes(player)) throw new Error(`unknown rung "${player}": ${RUNGS.join(', ')}`)
  return { ...record({ seed, level: player, ascension, monarch }), player, ascension }
}

// The jobs of --ladder: every rung of `rungs` on the same seeds at every level of `ascensions`.
export function ladderJobs ({ ascensions = [0], rungs = RUNGS, runs = 8, seed = 'sim', monarch = null } = {}) {
  return ascensions.flatMap((ascension) => rungs.flatMap((player) => Array.from({ length: runs }, (_, i) => ({
    ladder: true, seed: `${seed}-${i}`, player, ascension, ...asMonarch(monarch)
  }))))
}

// The ladder's table from its records: per level and rung the runs, clears, deaths by floor, progress and battles a
// run, and against the rung below (pairedStats); per level whether the rungs keep their order. → { …, rows, ordered }
export function ladderTable (records, { ascensions, rungs, runs, seed }) {
  const of = (a, rung) => records.filter((r) => (r.ascension ?? 0) === a && r.player === rung)
  const rows = []
  const ordered = {}
  for (const a of ascensions) {
    rungs.forEach((rung, j) => {
      const R = of(a, rung)
      const p = j ? pairedStats(of(a, rungs[j - 1]), R) : null
      rows.push({
        ascension: a,
        rung,
        runs: R.length,
        clears: R.filter(cleared).length,
        deaths: Array.from({ length: TUNING.run.floors }, (_, f) => R.filter((r) => !cleared(r) && r.floor === f + 1).length),
        progress: 100 * (meanOf(R.map((r) => r.progress)) ?? 0),
        battles: meanOf(R.map((r) => r.battles.length)) ?? 0,
        below: j ? rungs[j - 1] : null,
        won: p?.won ?? null,
        lost: p?.lost ?? null,
        diff: p?.diff ?? null,
        se: p?.se ?? null
      })
    })
    const mine = rows.filter((r) => r.ascension === a)
    ordered[a] = mine.every((r, j) => !j || r.progress > mine[j - 1].progress)
  }
  return { runs, seed, ascensions, rungs, rows, ordered }
}

export function ladderLines (t) {
  const out = [`the ladder: ${t.runs} seeds ${t.seed}-0…${t.runs - 1}, every rung on the same seeds at ascension ${t.ascensions.join(', ')} (redesign.md §3, §4.6)`]
  out.push(`${'asc'.padStart(3)}  ${'rung'.padEnd(8)}${'clears'.padStart(7)}${`died fl ${FLOORS().join('/')}`.padStart(17)}${'progress'.padStart(10)}${'battles'.padStart(9)}  against the rung below: clears won −lost, progress`)
  for (const r of t.rows) {
    out.push([
      String(r.ascension).padStart(3),
      '  ' + r.rung.padEnd(8),
      pct(r.clears / Math.max(1, r.runs)).padStart(7),
      r.deaths.join('/').padStart(17),
      r.progress.toFixed(1).padStart(10),
      r.battles.toFixed(1).padStart(9),
      r.below ? `  ${r.below} → ${r.rung}: +${r.won} −${r.lost}, ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)} ± ${r.se.toFixed(1)}` : ''
    ].join(''))
  }
  out.push(`the order kept (each rung's progress above the one below's): ${t.ascensions.map((a) => `${a} ${t.ordered[a] ? 'yes' : 'NO'}`).join(', ')}`)
  return out
}

// --ladder: every rung on the same seeds at every level of `ascensions`; at one level, the record players' detail too.
export async function ladder ({ runs, seed: seed0, ascensions = [0], monarch = null }) {
  const rungs = RUNGS
  const t0 = Date.now()
  const all = await playAll(ladderJobs({ ascensions, rungs, runs, seed: seed0, monarch }), { cache: CACHE })
  const t = ladderTable(all, { ascensions, rungs, runs, seed: seed0 })
  for (const line of ladderLines(t)) console.log(line)
  console.log(`(${all.length} runs in ${((Date.now() - t0) / 60000).toFixed(1)} min${monarchText(monarch)})`)
  if (ascensions.length > 1) {
    console.log('\n(the detail below is a level\'s: --ascension <level> for one)')
    return t
  }
  const levels = rungs
  const played = levels.flatMap((level) => all.filter((r) => r.player === level))
  console.log(`\nruns ${runs} per level (seed ${seed0}${ascensions[0] ? `, ascension ${ascensions[0]}` : ''}), the same seeds at each`)
  console.log(`level    clear  died on floor ${FLOORS().map((f, i) => (i ? String(f).padStart(7) : f)).join('')}  battles won  relics  reaped`)
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const pct = (n, d = runs) => `${(100 * n / d).toFixed(1)}%`
    const died = (f) => pct(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(7)
    const battles = mine.flatMap((r) => r.battles)
    const avg = (key) => (mine.reduce((n, r) => n + r[key], 0) / runs).toFixed(1)
    console.log(`${level.padEnd(6)}  ${pct(mine.filter((r) => r.result === 'victory').length).padStart(6)}  ${' '.repeat(8)}${FLOORS().map(died).join('')}  ${pct(battles.filter((b) => b.won).length, battles.length).padStart(11)}  ${avg('relics').padStart(6)}  ${avg('reaped').padStart(6)}`)
  })
  // The Monarch at the run's end, shadows raised per battle, and what ended the run (causesOf).
  console.log('\nlevel   monarch hp  com  arise  raised/battle  deaths by threat')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const raised = (battles.reduce((n, b) => n + b.raised, 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.monarch.maxHp).padStart(10)}  ${avg((r) => r.monarch.command).padStart(3)}  ${avg((r) => r.monarch.copies).padStart(5)}  ${raised.padStart(13)}  ${tally}`)
  })
  // The army: the ossuary at the end; per battle, the pieces fielded and fallen, the summons, the 2×2 pieces.
  console.log('\nlevel    ossuary   pieces/battle  fell/battle  summons/battle  2×2/battle')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const avg = (f) => (mine.reduce((n, r) => n + f(r), 0) / runs).toFixed(1)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    console.log(`${level.padEnd(6)}  ${avg((r) => r.ossuary).padStart(8)}  ${per('pieces').padStart(14)}  ${per('fell').padStart(11)}  ${per('summoned').padStart(14)}  ${per('colossi').padStart(10)}`)
  })
  // The enemy: waves and foes that entered per battle; the Monarch's deaths by threat, floor by floor.
  console.log('\nlevel   waves/battle  foes in/battle  Monarch deaths by threat, by floor')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const per = (key) => (battles.reduce((n, b) => n + b[key], 0) / Math.max(1, battles.length)).toFixed(2)
    const floors = {}
    for (const r of mine) {
      if (!r.death) continue
      const f = (floors[r.floor] ??= {})
      for (const k of causesOf(r.death)) f[k] = (f[k] ?? 0) + 1
    }
    const tally = Object.entries(floors).sort((a, b) => a[0] - b[0])
      .map(([f, c]) => `${f}: ${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`).join('; ') || '-'
    console.log(`${level.padEnd(6)}  ${per('waves').padStart(12)}  ${per('foesIn').padStart(14)}  ${tally}`)
  })
  // The share of the army that acted, the Monarch's deaths, depth and stalls; battle length by floor; the build spread.
  console.log('\nlevel   acted  Monarch deaths/defeats  top threat  depth  stalls')
  levels.forEach((level, i) => {
    const mine = played.slice(i * runs, (i + 1) * runs)
    const battles = mine.flatMap((r) => r.battles)
    const share = (n, d) => (d ? `${(100 * n / d).toFixed(0)}%` : '-')
    const army = battles.reduce((n, b) => n + b.army, 0)
    const lost = mine.filter((r) => r.death)
    const killed = lost.filter((r) => r.death.reason === 'monarch')
    const causes = {}
    for (const r of killed) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const top = Object.entries(causes).sort((a, b) => b[1] - a[1])[0]
    const cols = [
      level.padEnd(6),
      share(battles.reduce((n, b) => n + b.acted, 0), army).padStart(5),
      `${killed.length}/${lost.length} ${share(killed.length, lost.length)}`.padStart(22),
      (top ? `${top[0]} ${share(top[1], killed.length)}` : '-').padStart(10),
      String(killed.filter((r) => r.death.wave).length).padStart(5),
      String(lost.length - killed.length).padStart(6)
    ]
    console.log(cols.join('  '))
  })
  console.log('\nlevel   median battle turns by floor')
  levels.forEach((level, i) => {
    const floors = {}
    for (const b of played.slice(i * runs, (i + 1) * runs).flatMap((r) => r.battles)) (floors[b.floor] ??= []).push(b.t)
    const median = (ts) => ts.sort((a, b) => a - b)[Math.floor(ts.length / 2)]
    console.log(`${level.padEnd(6)}  ${Object.entries(floors).sort((a, b) => parseInt(a[0]) - parseInt(b[0]) || a[0].length - b[0].length).map(([f, ts]) => `${f}: ${median(ts)} (${ts.length})`).join('  ') || '-'}`)
  })
  console.log('\nlevel   wins  build spread in wins: the commonest Legendaries, kin, tracks, and Legendaries+kin')
  levels.forEach((level, i) => {
    const wins = played.slice(i * runs, (i + 1) * runs).filter((r) => r.result === 'victory')
    const commonest = (f) => {
      const n = {}
      for (const r of wins) n[f(r.build)] = (n[f(r.build)] ?? 0) + 1
      const [k, c] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] ?? ['-', 0]
      return `${k} ${wins.length ? (100 * c / wins.length).toFixed(0) : 0}%`
    }
    console.log(`${level.padEnd(6)}  ${String(wins.length).padStart(4)}  ${[(b) => b.legendaries, (b) => b.kin, (b) => b.tracks, (b) => `${b.legendaries}|${b.kin}`].map(commonest).join('; ')}`)
  })
  // The diversity block, a level at a time.
  levels.forEach((level, i) => {
    console.log('')
    for (const line of diversityLines(diversity(played.slice(i * runs, (i + 1) * runs)), level)) console.log(line)
  })
  return t
}

// ── decisions report ─────────────────────────────────────────────────────────────────────────────

// --decisions: how much the formation decides battles: every battle refought `tries` times with its souls in random
// open cells; `decided`, the share whose result changes; HP kept (0 for a loss) shows the rest.
export async function decisions ({ runs, seed: seed0, level, tries = 8, ascension = 0, monarch = null }) {
  const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level, setups: true, ...(ascension && { ascension }), ...asMonarch(monarch) })))
  const setups = played.flatMap((r) => r.battles.map((b) => b.setup))
  const rng = createRng(seed0).stream('decisions')
  const floors = {}
  const KEYS = ['n', 'auto', 'random', 'decided', 'autoHp', 'randomHp', 'spreadHp']
  for (const setup of setups) {
    const fight = (party) => {
      const b = playOut(createBattle({ ...setup, party, quiet: true }), TURNS[turnsOf(LEVELS[level])])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow)
      const hp = b.winner === 'party' ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0
      return { won: b.winner === 'party', hp }
    }
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(setup.camp, slot))
    // Each piece on a random open cell its footprint fits, the Monarch on its seat; one that fits nowhere sits out.
    const shuffle = (party) => {
      const cells = rng.shuffle(open)
      const taken = new Set()
      const out = []
      for (const u of [...party].sort((x, y) => isMonarch(y) - isMonarch(x))) {
        const size = u.size ?? sizeOf(u)
        const slot = isMonarch(u) ? monarchSlot(setup.camp) : cells.find((c) => fits(setup.camp, c, size, taken))
        if (slot === undefined) continue
        for (const c of footprintSlots(slot, size) ?? [slot]) taken.add(c)
        out.push({ ...u, slot })
      }
      return out
    }
    const auto = fight(setup.party)
    const random = Array.from({ length: tries }, () => fight(shuffle(setup.party)))
    const wins = random.filter((t) => t.won).length
    const f = (floors[setup.floor + (setup.boss ? 'B' : '')] ??= Object.fromEntries(KEYS.map((k) => [k, 0])))
    f.n++
    f.auto += auto.won
    f.random += wins / tries
    f.decided += wins > 0 && wins < tries
    f.autoHp += auto.hp
    f.randomHp += random.reduce((n, t) => n + t.hp, 0) / tries
    f.spreadHp += Math.max(...random.map((t) => t.hp)) - Math.min(...random.map((t) => t.hp))
  }
  const pct = (v, n) => `${(100 * v / n).toFixed(1)}%`
  const all = Object.fromEntries(KEYS.map((k) => [k, Object.values(floors).reduce((a, f) => a + f[k], 0)]))
  console.log(`runs ${runs} (seed ${seed0}, ${level} player${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}), ${all.n} battles, each refought ${tries}× with the souls in random cells`)
  console.log('decided: the share of battles whose result changes with where the souls stand.')
  const COLS = [['autoplayer', 'auto'], ['random', 'random'], ['decided', 'decided'],
    ['autoplayer', 'autoHp'], ['random', 'randomHp'], ['best−worst', 'spreadHp']]
  const width = (name) => Math.max(6, name.length)
  const groups = [['won', 2], ['', 1], ['HP kept', 3]]
  let at = 0
  console.log(' '.repeat(16) + groups.map(([name, n]) => {
    const w = COLS.slice(at, (at += n)).reduce((a, [c]) => a + width(c) + 2, 0)
    return name.padEnd(w)
  }).join('').trimEnd())
  console.log('floor  battles  ' + COLS.map(([c]) => c.padStart(width(c))).join('  '))
  for (const [k, f] of [...Object.entries(floors), ['all', all]]) {
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ` + COLS.map(([c, key]) => pct(f[key], f.n).padStart(width(c))).join('  '))
  }
}

// ── ablations: what each mechanic carries ────────────────────────────────────────────────────────────

// --ablations: the full expert and each of `variants` on the same seeds: clear rate, deaths, causes and uses, and each
// drop in clear rate and in progress (paired by seed, on the clear rate's scale by k) against its band:
//   CORE      orders, combos, tracks, summons: 25–50 points
//   EXTRA     fusions, legendaries, relics, synergies: 8–25 points
//   MEASURED  formation, moves: reported, no band
export const CORE = ['orders', 'combos', 'tracks', 'summons']
export const EXTRA = ['fusions', 'legendaries', 'relics', 'synergies']
export const MEASURED = ['formation', 'moves']
export const BANDS = { ...Object.fromEntries(CORE.map((m) => [m, [25, 50]])), ...Object.fromEntries(EXTRA.map((m) => [m, [8, 25]])) }
export async function ablations ({ runs, seed: seed0, variants = ABLATIONS, out = null, ascension = 0, monarch = null }) {
  variants = [null, ...variants]
  const t0 = Date.now()
  const played = await playAll(variants.flatMap((ablate) => Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', ablate, ...(ascension && { ascension }), ...asMonarch(monarch) }))), { cache: CACHE })
  // With `out`, every run's outcome as JSON (for pairing two sweeps seed by seed).
  if (out) {
    fs.writeFileSync(out, JSON.stringify({
      runs, seed: seed0, ...(ascension && { ascension }), ...asMonarch(monarch), minutes: (Date.now() - t0) / 60000,
      played: played.map((r, i) => ({ seed: `${seed0}-${i % runs}`, ablate: variants[Math.floor(i / runs)], result: r.result, floor: r.floor, fell: r.fell, progress: r.progress, secs: r.secs }))
    }, null, 1))
  }
  console.log(`runs ${runs} per variant (seed ${seed0}${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}), the expert with one mechanic taken away, the same seeds each; ${((Date.now() - t0) / 60000).toFixed(1)} min` +
    ` (${(played.reduce((n, r) => n + r.secs, 0) / played.length).toFixed(1)} s a run)`)
  console.log(`variant        clear  died on floor ${FLOORS().map((f, i) => (i ? String(f).padStart(5) : f)).join('')}   drop  Monarch deaths by threat`)
  const clear = (mine) => mine.filter((r) => r.result === 'victory').length / runs
  const full = clear(played.slice(0, runs))
  const rows = variants.map((ablate, i) => ({ ablate, mine: played.slice(i * runs, (i + 1) * runs) }))
  for (const { ablate, mine } of rows) {
    const died = (f) => String(mine.filter((r) => r.result !== 'victory' && r.floor === f).length).padStart(5)
    const causes = {}
    for (const r of mine) for (const k of causesOf(r.death)) causes[k] = (causes[k] ?? 0) + 1
    const tally = Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'
    const drop = ablate ? (100 * (full - clear(mine))).toFixed(0) : '-'
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${(100 * clear(mine)).toFixed(0).padStart(4)}%  ${' '.repeat(13)}${FLOORS().map(died).join('')}  ${drop.padStart(5)}  ${tally}`)
  }
  console.log('\nuses over the runs: orders given in battle (moves and acts), recruits made, fusions made, track tiers held, relics')
  console.log('held when they ended (Legendaries, the rest), and relics given to a soul')
  console.log('variant        orders  reaped  fuse  tiers  legend  relics  holds')
  for (const { ablate, mine } of rows) {
    const sum = (f) => String(mine.reduce((n, r) => n + f(r), 0)).padStart(6)
    console.log(`${(ablate ?? 'full').padEnd(13)}  ${[(r) => (r.acts.move ?? 0) + (r.acts.act ?? 0), (r) => r.reaped,
      (r) => r.acts.fuse ?? 0, (r) => r.tiers, (r) => r.legendaries.length, (r) => r.relics - r.legendaries.length, (r) => r.acts.hold ?? 0].map(sum).join(' ')}`)
  }
  // Progress, paired by seed: each variant's drop ± its standard error, put on the clear rate's scale by k, the
  // least-squares slope through the origin of the clear drops on the progress drops.
  const prog = rows.map(({ mine }) => mine.map((r) => r.progress))
  const mean = (xs) => xs.reduce((n, x) => n + x, 0) / xs.length
  const se = (xs) => xs.length > 1 ? Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length) : 0
  const pdrops = rows.map(({ ablate, mine }, i) => {
    const diff = prog[0].map((p, j) => 100 * (p - prog[i][j]))
    return { ablate, clearDrop: 100 * (full - clear(mine)), drop: mean(diff), se: se(diff) }
  }).slice(1)
  const sxy = pdrops.reduce((n, d) => n + d.drop * d.clearDrop, 0)
  const sxx = pdrops.reduce((n, d) => n + d.drop * d.drop, 0)
  const k = sxx > 0 ? sxy / sxx : 1
  const verdict = (ablate, v) => !BANDS[ablate] ? '(no band)' : v < BANDS[ablate][0] ? 'under' : v > BANDS[ablate][1] ? 'over' : 'in'
  console.log(`\nprogress: rooms completed of the ${routeRooms()} on the route to the Sovereign, the battle lost counted by the share of its`)
  console.log(`foe HP removed (1 = cleared); drops in points, paired by seed (± one standard error of the paired difference);`)
  console.log(`clear-eq = k × progress drop, k = ${sxx > 0 ? k.toFixed(2) : '1 (no drop to fit)'}: the least-squares slope through the origin of the clear drop on the progress drop (${pdrops.length} variants)`)
  console.log('variant        clear  progress   ±se   drop    ±se  clear-eq   ±se  band    verdict')
  console.log(`${'full'.padEnd(13)}  ${(100 * full).toFixed(0).padStart(4)}%  ${(100 * mean(prog[0])).toFixed(1).padStart(8)}  ${(100 * se(prog[0])).toFixed(1).padStart(4)}`)
  for (const [i, d] of pdrops.entries()) {
    const band = BANDS[d.ablate] ? BANDS[d.ablate].join('–') : '-'
    console.log(`${d.ablate.padEnd(13)}  ${(100 * clear(rows[i + 1].mine)).toFixed(0).padStart(4)}%  ${(100 * mean(prog[i + 1])).toFixed(1).padStart(8)}  ${' '.repeat(4)}  ${d.drop.toFixed(1).padStart(5)}  ${d.se.toFixed(1).padStart(5)}  ` +
      `${(k * d.drop).toFixed(1).padStart(8)}  ${(k * d.se).toFixed(1).padStart(4)}  ${band.padEnd(6)}  ${verdict(d.ablate, k * d.drop)}`)
  }
  const drops = rows.filter((r) => BANDS[r.ablate]).map((r) => ({ ablate: r.ablate, drop: 100 * (full - clear(r.mine)), band: BANDS[r.ablate] }))
  const list = (xs) => xs.map((d) => `${d.ablate} ${d.drop.toFixed(0)}`).join(', ') || '-'
  console.log(`\ncheck: full expert ${(100 * full).toFixed(0)}% (target >= 90%), progress ${(100 * mean(prog[0])).toFixed(1)}; drops against their bands (core 25–50: ${CORE.join(', ')}; extra 8–25: ${EXTRA.join(', ')}; measured, no band: ${MEASURED.join(', ')})`)
  const eq = pdrops.filter((d) => BANDS[d.ablate]).map((d) => ({ ablate: d.ablate, drop: k * d.drop, band: BANDS[d.ablate] }))
  console.log('  by clear-eq (k × progress drop):')
  console.log(`    in band: ${list(eq.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(eq.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(eq.filter((d) => d.drop > d.band[1]))}`)
  console.log('  by clear rate:')
  console.log(`    in band: ${list(drops.filter((d) => d.drop >= d.band[0] && d.drop <= d.band[1]))}`)
  console.log(`    too small: ${list(drops.filter((d) => d.drop < d.band[0]))}`)
  console.log(`    too large: ${list(drops.filter((d) => d.drop > d.band[1]))}`)
}

// ── necessity: the same, battle by battle (a fast proxy) ─────────────────────────────────────────────

// A run as it stood before a fight (a record's snapshot) with one mechanic stripped (null: as it was), for battleSetup:
//   orders, moves              as it stood: refight plays it with End Turn alone, or never moving a piece
//   arise, synergies, summons  the rules switch
//   fusions                    every fused piece back in its parts
//   tracks                     no tier on any track, every soul at the level that gives
//   legendaries                no Legendary relic
//   relics                     no Common, Uncommon or Rare relic
//   formation                  the souls in basic's first draft's cells
// Wounds are kept as a share. → a run { state, battle, setup }
export const NECESSITY = ABLATIONS
export function stripped (state, mechanic = null) {
  const s = structuredClone(state)
  const run = { state: s, battle: null, setup: null }
  const team = souls(s.party)
  const relevel = (u, lvl) => {
    const max = baseStats(u.id, lvl).hp
    u.hp = u.hp > 0 ? Math.max(1, Math.round(u.hp / u.maxHp * max)) : 0
    u.lvl = lvl
    u.maxHp = max
  }
  if (RULE_SWITCHES.includes(mechanic)) {
    s.ablate = [...(s.ablate ?? []), mechanic]
  } else if (mechanic === 'fusions') {
    unfused(s)
  } else if (mechanic === 'tracks') {
    for (const u of team) {
      u.tracks = [0, 0]
      relevel(u, levelOf(u))
    }
  } else if (mechanic === 'legendaries') {
    s.relics = s.relics.filter((id) => !legendary(id))
  } else if (mechanic === 'relics') {
    s.relics = s.relics.filter(legendary)
  } else if (mechanic === 'formation') {
    const at = new Map(basicCells(run, fielded(s.party), LEVELS.expert).map((u) => [u.uid, u.slot]))
    for (const u of s.party) if (at.has(u.uid)) u.slot = at.get(u.uid)
  } else if (mechanic !== null && mechanic !== 'orders' && mechanic !== 'moves') {
    throw new Error(`unknown mechanic "${mechanic}": ${NECESSITY.join(', ')}`)
  }
  // A soul holds only relics the run still owns (a relic stripped is no one's).
  const owned = s.relics.slice()
  for (const u of souls(s.party)) {
    if (!u.relics) continue
    u.relics = u.relics.filter((id) => {
      const i = owned.indexOf(id)
      if (i >= 0) owned.splice(i, 1)
      return i >= 0
    })
  }
  // The Monarch's max HP as its relics now give it (its wounds kept as a share).
  const m = monarchOf(s)
  const max = monarchHp(s)
  if (m.maxHp !== max) {
    m.hp = m.hp > 0 ? Math.max(1, Math.round(m.hp / m.maxHp * max)) : 0
    m.maxHp = max
  }
  // A smaller field (no relic adding Command): the weakest standing souls past it to the ossuary.
  const cap = fieldCap(run)
  for (const u of standing(fielded(souls(s.party))).sort(byFieldPower).slice(cap)) u.slot = -1
  return run
}

// Every fused piece of `s` back in its recipe's parts, each at the level and tiers of its kind's soul held with the most
// tiers (none held: its first level, no tier), wounded as it was, each on the first of its cells it fits, else in the
// ossuary. Mutates s.
function unfused (s) {
  for (const u of souls(s.party).filter((x) => unitDef(x.id).fused)) {
    const recipe = FUSION_LIST.find((r) => r.result === u.id)
    if (!recipe) continue
    const cells = cellsOf(u)
    s.party = s.party.filter((x) => x !== u)
    const taken = new Set(s.party.filter((x) => x.slot >= 0).flatMap(cellsOf))
    for (const [kind, n] of Object.entries(recipe.needs)) {
      const k = souls(s.party).filter((x) => x.id === kind).reduce((a, x) => (x.tracks[0] + x.tracks[1] > a.tracks[0] + a.tracks[1] ? x : a), { lvl: firstLevel(), tracks: [0, 0] })
      for (let i = 0; i < n; i++) {
        const part = makeUnit(kind, { uid: s.nextUid++, lvl: k.lvl, tracks: k.tracks.slice() })
        part.hp = u.hp > 0 ? Math.max(1, Math.round(part.maxHp * hpPct(u))) : 0
        part.slot = cells.find((c) => fits(s.camp, c, sizeOf(part), taken)) ?? -1
        cellsOf(part).forEach((c) => taken.add(c))
        s.party.push(part)
      }
    }
  }
}

// Refights each snapshot as it stood and once per mechanic stripped, under its turn policy less that mechanic
// (ablatedTurns). → per snapshot, per variant { won, alive, hp }, and `same`: the as-it-stood refight replayed exactly
export function refight ({ snaps, variants = [null, ...NECESSITY] }) {
  return snaps.map(({ snapshot, outcome }) => {
    const out = {}
    for (const m of variants) {
      // Only the as-it-stood refight is compared event by event; the rest keep no events.
      const b = playOut(createBattle({ ...battleSetup(stripped(snapshot, m)), quiet: m !== null }), TURNS[ablatedTurns(outcome?.turns ?? 'basic', m)])
      const mine = b.units.filter((u) => u.side === 'party' && !u.shadow)
      const won = b.winner === 'party'
      out[m ?? 'full'] = { won, alive: !!b.monarch && b.monarch.hp > 0, hp: won ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0 }
      if (m === null) out.same = !!outcome && timelineHash(b.events) === outcome.hash
    }
    return out
  })
}

// --necessity: the full expert's battles over `runs` runs (`setups`: a file read if there, else written), each refought
// as it stood and per mechanic stripped: battles won, the Monarch standing, HP kept, by floor.
export async function necessity ({ runs, seed: seed0, setups: file = null, ascension = 0, monarch = null }) {
  const t0 = Date.now()
  let snaps
  if (file && fs.existsSync(file)) {
    snaps = JSON.parse(fs.readFileSync(file, 'utf8'))
  } else {
    const played = await playAll(Array.from({ length: runs }, (_, i) => ({ seed: `${seed0}-${i}`, level: 'expert', snapshots: true, ...(ascension && { ascension }), ...asMonarch(monarch) })))
    snaps = played.flatMap((r) => r.battles.map((b) => ({ floor: b.floor, snapshot: b.snapshot, outcome: b.outcome })))
    if (file) fs.writeFileSync(file, JSON.stringify(snaps))
  }
  const t1 = Date.now()
  const { availableParallelism } = await import('node:os')
  const per = Math.max(1, Math.ceil(snaps.length / (2 * availableParallelism())))
  const chunks = []
  for (let i = 0; i < snaps.length; i += per) chunks.push({ refight: true, snaps: snaps.slice(i, i + per) })
  const results = (await playAll(chunks)).flat()
  const variants = ['full', ...NECESSITY]
  const floors = [...new Set(snaps.map((x) => x.floor))]
  console.log(`necessity: ${snaps.length} battles of the full expert (${file && t1 - t0 < 1000 ? `from ${file}` : `${runs} runs, seed ${seed0}${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}`}), ` +
    `each refought as it stood and with one mechanic stripped; record ${((t1 - t0) / 60000).toFixed(1)} min, refights ${((Date.now() - t1) / 60000).toFixed(1)} min`)
  console.log(`as it stood, refights identical to the real battle: ${results.filter((r) => r.same).length}/${results.length}`)
  // Runs clean: the recorded runs whose every battle is still won with the mechanic stripped, and its drop in points.
  const seeds = [...new Set(snaps.map((x) => x.snapshot.seed))]
  const clean = (v) => seeds.filter((seed) => results.every((r, i) => snaps[i].snapshot.seed !== seed || r[v].won)).length / seeds.length
  const base = clean('full')
  console.log(`runs: ${seeds.length}; "runs clean": runs whose every battle is won; "drop": its fall against full, in points`)
  console.log('variant        won   Monarch stood  HP kept   lost  runs clean  drop   ' + floors.map((f) => `fl ${f}`.padStart(6)).join(''))
  const pct = (n, d) => (d ? `${(100 * n / d).toFixed(1)}%` : '-')
  for (const v of variants) {
    const all = results.map((r) => r[v])
    const won = all.filter((x) => x.won).length
    const cols = floors.map((f) => {
      const here = results.filter((_, i) => snaps[i].floor === f).map((r) => r[v])
      return pct(here.filter((x) => x.won).length, here.length).padStart(7)
    })
    const drop = v === 'full' ? '-' : (100 * (base - clean(v))).toFixed(0)
    console.log(`${v.padEnd(13)}  ${pct(won, all.length).padStart(6)}  ${pct(all.filter((x) => x.alive).length, all.length).padStart(13)}  ${pct(all.reduce((n, x) => n + x.hp, 0), all.length).padStart(7)}  ${String(all.length - won).padStart(5)}  ${pct(clean(v), 1).padStart(10)}  ${drop.padStart(4)}   ${cols.join('')}`)
  }
}

// ── the harness: builds committed, the diversity block, the pool ─────────────────────────────────

const PLAYERS = Object.freeze(['expert', 'teacher'])
// The outside teacher as the harness plays it: every phase, the expert's top six, the first line that clears taken.
const TEACHER = Object.freeze({ won: true })

// One run of the harness: seed `seed` played by `player`, committed to `commit` (null: free play); the teacher's with its
// counts (`teacher`: decisions played out, playouts, overrides). → a promise of record's result, with `player`
export async function buildRecord ({ seed, player = 'expert', commit = null, strict = false, scale = 1, ascension = 0, monarch = BASE_MONARCH }) {
  if (!PLAYERS.includes(player)) throw new Error(`unknown player "${player}": ${PLAYERS.join(', ')}`)
  const held = strict && commit ? { strict: true } : {}
  if (player === 'expert') return { ...withCommit(commit, () => record({ seed, level: 'expert', scale, ascension, monarch }), strict), ...held, player }
  const { outsideTeacher, outsideStats } = await import('./outside.js')
  let run = null
  const act = (r, rng) => outsideTeacher((run = r), rng, TEACHER)
  const out = withCommit(commit, () => record({ seed, level: 'expert', scale, ascension, monarch, act }), strict)
  const phases = Object.values(outsideStats(run).phases)
  const sum = (k) => phases.reduce((n, p) => n + p[k], 0)
  return { ...out, ...held, player, teacher: { decisions: sum('decided'), playouts: sum('playouts'), overrides: sum('overrides') } }
}
// A job's key for its time (playAll's order); a harness's and a ladder's by their own fields too.
const jobKey = (job) => (job.builds ? `${job.seed}|builds|${job.player}|${job.commit ?? 'free'}${job.strict && job.commit ? '|strict' : ''}|${job.scale}${job.ascension ? `|a${job.ascension}` : ''}${job.monarch ? `|m:${job.monarch}` : ''}`
  : job.ladder ? `${job.seed}|ladder|${job.player}|a${job.ascension}${job.monarch ? `|m:${job.monarch}` : ''}` : timeKey(job))

// The jobs of --builds: free play, then each archetype of `commits` committed, on the same seeds.
export function buildJobs ({ player = 'expert', commits = ARCHETYPES(), strict = false, scale = 1, ascension = 0, monarch = null, runs = 256, seed = 'div', from = 0 } = {}) {
  const seeds = Array.from({ length: runs }, (_, i) => `${seed}-${from + i}`)
  return [null, ...commits].flatMap((commit) => seeds.map((s) => ({ builds: true, seed: s, player, commit, ...(strict && commit && { strict: true }), scale, ascension, ...asMonarch(monarch) })))
}
// The archetypes a --commit names: `all`, `fused`, `synergies`, `none`, or a comma-separated list, each checked.
export function commitsOf (spec = 'all') {
  const all = ARCHETYPES()
  const groups = { all, fused: all.filter((a) => !synergyOf(a)), synergies: all.filter(synergyOf), none: [] }
  if (groups[spec]) return groups[spec]
  const list = String(spec).split(',').filter(Boolean)
  for (const a of list) if (!all.includes(a)) throw new Error(`unknown archetype "${a}": ${all.join(', ')}`)
  return list
}

const synergiesAt = (b) => (b.events.find((e) => e.type === 'battle:start')?.synergies ?? []).filter((x) => x.side === 'party').map((x) => x.id)
// What leads a battle's fielded pieces: the kin most of them share and the fused kind most are (null for none).
function leadOf (pieces) {
  const most = (ids) => {
    const n = {}
    for (const id of ids) n[id] = (n[id] ?? 0) + 1
    return Object.entries(n).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null
  }
  return { kin: most(pieces.map((u) => unitDef(u.id).kin).filter(Boolean)), fused: most(pieces.filter((u) => unitDef(u.id).fused).map((u) => u.id)) }
}
// A run's build at its end: the kinds of the souls it holds (`army`) and fielded last (`field`), each recipe with the
// battles its fused pieces first stood in (`made`, 1-based), and the relics it bought (`bought`, in order).
function builtOf (run) {
  const s = run.state
  const made = {}
  let battle = 0
  for (const a of s.log) {
    if (a.type === 'fight') battle++
    // A fusion is made between battles: it counts toward the battle it precedes.
    if (a.type === 'fuse') (made[a.id] ??= []).push(battle + 1)
  }
  return { army: souls(s.party).map((u) => u.id), field: run.setup ? souls(run.setup.party).map((u) => u.id) : [], made, bought: s.relics.slice() }
}
// A run's margin at its end, as its last battle ended: the Monarch's HP share, the share its fighting pieces kept, the
// battles lost, the essence left and the turns its battles took.
export function endOf (run, battles) {
  const b = run.battle
  const m = b?.monarch
  let hp = 0
  let max = 0
  for (const u of b?.units ?? []) {
    if (u.side !== 'party' || u.shadow || u === m) continue
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  return {
    monarch: m ? +(Math.max(0, m.hp) / m.maxHp).toFixed(4) : 0,
    souls: max ? +(hp / max).toFixed(4) : 0,
    lost: battles.filter((x) => !x.won).length,
    essence: run.state.essence,
    turns: battles.reduce((n, b) => n + b.t, 0)
  }
}

const cleared = (r) => r.result === 'victory'
const meanOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const medianOf = (xs) => (xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null)
// The battle (1-based) in which record `r` first reached archetype `arch` (its recipe made, its synergy held), or null.
export function reachedAt (r, arch) {
  if (synergyOf(arch)) {
    const i = r.battles.findIndex((b) => b.syn.includes(arch))
    return i < 0 ? null : i + 1
  }
  const at = FUSION_LIST.filter((x) => x.result === arch).flatMap((x) => r.built.made[x.id] ?? [])
  return at.length ? Math.min(...at) : null
}

// A row of --builds: runs `R` of archetype `arch` (null: free play) against free play's `F` on the same seeds: clears,
// progress and its paired difference, deaths, the margin over the clears, the share that reached it and when, seconds.
export function buildRow (R, arch = null, F = null) {
  const won = R.filter(cleared)
  const battles = R.flatMap((r) => r.battles)
  const at = arch ? R.map((r) => reachedAt(r, arch)).filter((x) => x !== null) : []
  const paired = F && arch ? pairedStats(F, R) : null
  return {
    arch,
    runs: R.length,
    clears: won.length,
    progress: 100 * meanOf(R.map((r) => r.progress)),
    diff: paired?.diff ?? null,
    se: paired?.se ?? null,
    deaths: Array.from({ length: TUNING.run.floors }, (_, f) => R.filter((r) => !cleared(r) && r.floor === f + 1).length),
    monarch: won.length ? 100 * meanOf(won.map((r) => r.end.monarch)) : null,
    souls: won.length ? 100 * meanOf(won.map((r) => r.end.souls)) : null,
    essence: meanOf(won.map((r) => r.end.essence)),
    lost: R.reduce((n, r) => n + r.end.lost, 0),
    turns: battles.length ? battles.reduce((n, b) => n + b.t, 0) / battles.length : null,
    reached: arch ? at.length / Math.max(1, R.length) : null,
    first: arch ? medianOf(at) : null,
    secs: meanOf(R.map((r) => r.secs))
  }
}

// What a group of runs made, each a share: final armies' archetypes, kinds held, recipes made, roles and kins fielded
// last, synergies held a battle, relics bought, the altars' rites and the pivots after floor 1.
export function diversity (R) {
  const n = R.length
  const battles = R.flatMap((r) => r.battles)
  const share = (k, d) => (d ? k / d : 0)
  const tally = (keys) => {
    const out = {}
    for (const k of keys) out[k] = (out[k] ?? 0) + 1
    return out
  }
  const ranked = (o, d) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, share(v, d)]))
  const runsWith = (f) => tally(R.flatMap((r) => [...new Set(f(r))]))
  const field = R.flatMap((r) => r.built.field.map(unitDef))
  const bought = R.flatMap((r) => r.built.bought)
  return {
    runs: n,
    battles: battles.length,
    archetypes: ranked(runsWith((r) => [...r.built.army.filter((id) => unitDef(id).fused), ...(r.battles.at(-1)?.syn ?? [])]), n),
    kinds: ranked(runsWith((r) => r.built.army), n),
    roles: ranked(tally(field.map((u) => u.role)), field.length),
    kins: ranked(tally(field.map((u) => u.kin)), field.length),
    made: ranked(runsWith((r) => Object.keys(r.built.made)), n),
    fusions: Object.fromEntries(FUSION_LIST.map((x) => [x.id, R.reduce((k, r) => k + (r.built.made[x.id]?.length ?? 0), 0)])),
    synergies: ranked(tally(battles.flatMap((b) => b.syn)), battles.length),
    none: share(battles.filter((b) => !b.syn.length).length, battles.length),
    relics: ranked(tally(bought), bought.length),
    perRun: share(bought.length, n),
    command: share(bought.filter((id) => gives(relicDef(id), 'run.command')).length, bought.length),
    altar: altarRites(R),
    pivot: pivots(R)
  }
}

// The rites taken at the altars (a record's `acts`): altars a run, and each rite's share of them.
export function altarRites (R) {
  const n = { heal: 0, transmute: 0, consecrate: 0 }
  for (const r of R) for (const k in n) n[k] += r.acts?.[k] ?? 0
  const all = n.heal + n.transmute + n.consecrate
  return { perRun: R.length ? all / R.length : 0, ...Object.fromEntries(Object.entries(n).map(([k, v]) => [k, all ? v / all : 0])) }
}
// The runs that turned after floor 1: of those that fought past it (`of`), those whose last lead (leadOf) is not floor
// 1's last, by kin and by fused kind (`fusedOf`: both fielded one), each with how many cleared.
export function pivots (R) {
  const out = { of: 0, kin: 0, kinCleared: 0, fusedOf: 0, fused: 0, fusedCleared: 0 }
  for (const r of R) {
    const one = r.battles.filter((b) => parseInt(b.floor) === 1).at(-1)?.lead
    const last = r.battles.at(-1)
    if (!one || !last?.lead || parseInt(last.floor) === 1) continue
    out.of++
    if (one.kin !== last.lead.kin) { out.kin++; out.kinCleared += cleared(r) }
    if (!one.fused || !last.lead.fused) continue
    out.fusedOf++
    if (one.fused !== last.lead.fused) { out.fused++; out.fusedCleared += cleared(r) }
  }
  return out
}

// The diversity block's checks: no fused kind in over 30% of final armies; every base recipe made in 8%+ of runs; six or
// more synergies each held in 5%+ of battles; and the kinds held in a tenth of final armies or more.
export function diversityChecks (d) {
  const fused = Object.entries(d.archetypes).filter(([id]) => !synergyOf(id))[0] ?? ['-', 0]
  const base = FUSION_LIST.filter((x) => Object.keys(x.needs).every((id) => !unitDef(id).fused))
  const rare = base.filter((x) => (d.made[x.id] ?? 0) < 0.08).map((x) => x.id)
  const synergies = SYNERGIES.filter((x) => (d.synergies[x.id] ?? 0) >= 0.05).map((x) => x.id)
  return {
    fused: { id: fused[0], share: fused[1], ok: fused[1] <= 0.3 },
    recipes: { rare, ok: !rare.length },
    synergies: { ids: synergies, ok: synergies.length >= 6 },
    kinds: { ids: Object.entries(d.kinds).filter(([, v]) => v >= 0.1).map(([k]) => k), of: UNIT_LIST.filter((u) => (u.spawn || u.fused) && !u.boss).length }
  }
}

const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`
const listOf = (o, top = Infinity) => Object.entries(o).slice(0, top).map(([k, v]) => `${k} ${pct(v)}`).join(', ') || '-'
const met = (ok) => (ok ? 'met' : 'NOT MET')

export function buildLines (rows, { player = 'expert', strict = false, scale = 1, ascension = 0, monarch = null, runs, seed } = {}) {
  const how = strict ? 'strictly (its combos of the book, its kinds drafted and recruited where offered, its recipes alone fused)' : '(its combos of the book alone)'
  const out = [`builds: the ${player}, ${runs} seeds ${seed}-0…${runs - 1}${ascension ? `, ascension ${ascension}` : ''}${monarchText(monarch)}${scale !== 1 ? `, every foe's HP and ATK ×${scale}` : ''}; each archetype committed ${how} on free play's seeds`]
  out.push(`${'archetype'.padEnd(16)}${'clears'.padStart(7)}${'progress'.padStart(9)}${'vs free'.padStart(15)}  ${`died fl ${FLOORS().join('/')}`.padStart(15)}  ${'mon'.padStart(4)}${'souls'.padStart(6)}${'ess'.padStart(6)}${'lost'.padStart(5)}${'t/b'.padStart(6)}  ${'made'.padStart(5)}${'at'.padStart(4)}${'s/run'.padStart(7)}`)
  const num = (x, d = 0) => (x === null ? '-' : x.toFixed(d))
  for (const r of rows) {
    out.push([
      (r.arch ?? 'free play').padEnd(16),
      pct(r.clears / Math.max(1, r.runs)).padStart(7),
      r.progress.toFixed(1).padStart(9),
      (r.diff === null ? '' : `${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)} ± ${r.se.toFixed(1)}`).padStart(15),
      '  ' + r.deaths.join('/').padStart(15),
      '  ' + num(r.monarch).padStart(4),
      num(r.souls).padStart(6),
      num(r.essence).padStart(6),
      String(r.lost).padStart(5),
      num(r.turns, 1).padStart(6),
      '  ' + (r.reached === null ? '' : pct(r.reached)).padStart(5),
      String(r.first ?? '').padStart(4),
      num(r.secs, 1).padStart(7)
    ].join(''))
  }
  out.push('  vs free: progress against free play seed for seed (± one standard error of the paired difference); mon, souls,')
  out.push('  ess: the Monarch\'s and its pieces\' share of their HP (%) as the last battle ended, and the essence left, each the')
  out.push('  mean over the clears; lost: battles lost; t/b: turns a battle; made: runs that made its fusion or held its synergy;')
  out.push('  at: the median battle it came on')
  return out
}

export function diversityLines (d, label = 'free play') {
  const c = diversityChecks(d)
  const fusions = Object.keys(d.fusions).sort((a, b) => (d.made[b] ?? 0) - (d.made[a] ?? 0)).map((id) => `${id} ${pct(d.made[id] ?? 0)} (${d.fusions[id]})`).join(', ')
  return [
    `diversity, ${label} (${d.runs} runs, ${d.battles} battles; criterion 3):`,
    `  final armies' archetypes   ${listOf(d.archetypes)}   [no fused kind above 30%: ${met(c.fused.ok)}${c.fused.ok ? '' : `, ${c.fused.id} ${pct(c.fused.share)}`}]`,
    `  kinds held at the end      ${listOf(d.kinds, 12)}   [${c.kinds.ids.length} of ${c.kinds.of} kinds in a tenth or more]`,
    `  fielded in the last battle roles: ${listOf(d.roles)}; kins: ${listOf(d.kins)}`,
    `  fusions made (runs, made)  ${fusions}   [every base recipe in 8%+: ${met(c.recipes.ok)}${c.recipes.ok ? '' : `, ${c.recipes.rare.join(', ')} short`}]`,
    `  synergies (battles)        ${listOf(d.synergies)}, none ${pct(d.none)}   [six or more at 5%+: ${c.synergies.ids.length}, ${met(c.synergies.ok)}]`,
    `  relics bought              ${d.perRun.toFixed(1)} a run, Command ${pct(d.command)}: ${listOf(d.relics, 8)}`,
    `  altars' rites              ${d.altar.perRun.toFixed(1)} a run: heal ${pct(d.altar.heal)}, transmute ${pct(d.altar.transmute)}, consecrate ${pct(d.altar.consecrate)}`,
    `  turned after floor 1       of ${d.pivot.of} runs past it, the kin leading ${d.pivot.kin} (${d.pivot.kinCleared} cleared); of ${d.pivot.fusedOf} fielding a fused kind on both, the fused kind ${d.pivot.fused} (${d.pivot.fusedCleared} cleared)`
  ]
}

// --builds: plays the jobs and prints the rows and free play's diversity block; `out`: all of it as JSON; `sequential`:
// each archetype stopped once decided (buildsSequential). → { rows, diversity, records, sequential }
export async function builds ({ player = 'expert', commits = ARCHETYPES(), strict = false, scale = 1, ascension = 0, monarch = null, runs = 256, seed = 'div', out = null, log = console.log, sequential = false, block = 64, design = 'peto', alpha = 0.05, minGain = SEQ.MIN_GAIN } = {}) {
  if (!PLAYERS.includes(player)) throw new Error(`unknown player "${player}": ${PLAYERS.join(', ')}`)
  if (!(scale > 0)) throw new Error(`scale ${scale}: a multiplier above 0`)
  ascensionsOf(String(ascension))
  const t0 = Date.now()
  const how = { player, strict, scale, ascension, monarch, seed }
  const seq = sequential && commits.length ? await buildsSequential({ ...how, commits, runs, block, design, alpha, minGain }) : null
  const played = seq ? [...seq.free, ...seq.each.flat()] : await playAll(buildJobs({ ...how, commits, runs }), { cache: CACHE })
  const free = seq ? seq.free : played.slice(0, runs)
  const each = seq ? seq.each : commits.map((_, k) => played.slice((k + 1) * runs, (k + 2) * runs))
  const rows = [buildRow(free), ...commits.map((arch, k) => buildRow(each[k], arch, free.slice(0, each[k].length)))]
  const d = diversity(free)
  for (const line of [...buildLines(rows, { ...how, runs: free.length }), ...(seq ? ['', ...buildStopLines(seq, { minGain })] : []), '', ...diversityLines(d)]) log(line)
  if (player === 'teacher') {
    const per = (k) => (played.reduce((n, r) => n + r.teacher[k], 0) / played.length).toFixed(1)
    log(`the teacher a run: ${per('decisions')} decisions played out, ${per('playouts')} playouts, ${per('overrides')} overrides of the expert's pick`)
  }
  log(`(${played.length} runs in ${((Date.now() - t0) / 60000).toFixed(1)} min)`)
  // Sequential, the records are free play's seeds played and then each archetype's, `sequential.stops[k].n` of them.
  const stops = seq && { max: runs, block, design, alpha, minGain, stops: seq.stops }
  if (out) fs.writeFileSync(out, JSON.stringify({ player, ...(strict && { strict }), scale, ascension, seed, runs: free.length, commits, rows, diversity: d, ...(seq && { sequential: stops }), records: played }) + '\n')
  return { rows, diversity: d, records: played, ...(seq && { sequential: stops }) }
}
// --builds --sequential: free play and each archetype in blocks, each archetype dropped once decided against free play,
// to `runs` at most. → { free, each: [an archetype's records], stops, plan }
async function buildsSequential ({ commits, runs, block, design, alpha, minGain, ...how }) {
  const p = SEQ.plan({ runs, block, design, alpha })
  const free = []
  const each = commits.map(() => [])
  const stops = commits.map(() => null)
  for (let k = 0; stops.includes(null); k++) {
    const live = commits.map((_, j) => j).filter((j) => !stops[j])
    const n = p.looks[k] - free.length
    const played = await playAll(buildJobs({ ...how, commits: live.map((j) => commits[j]), runs: n, from: free.length }), { cache: CACHE })
    free.push(...played.slice(0, n))
    live.forEach((j, i) => each[j].push(...played.slice((i + 1) * n, (i + 2) * n)))
    for (const j of live) {
      const s = SEQ.look(free, each[j])
      const x = { arch: commits[j], k, ...s, ...SEQ.decide(s, k, p, { minGain }) }
      if (x.decision !== 'continue') stops[j] = x
    }
  }
  return { free, each, stops, plan: p }
}
// Where each archetype of a sequential --builds stopped, as lines.
function buildStopLines ({ stops, plan: p }, { minGain = SEQ.MIN_GAIN } = {}) {
  return [`sequential: each archetype against free play, blocks of ${p.looks[0]} to at most ${p.looks.at(-1)} seeds; ${SEQ.DESIGN_NAMES[p.design]}, two-sided α ${p.alpha}; futile below ${minGain >= 0 ? '+' : ''}${minGain} points`,
    ...stops.map((x) => `  ${x.arch.padEnd(16)}${SEQ.stopLine(x, p, { minGain })}`)]
}

// ── the pool: what a run can gather ──────────────────────────────────────────────────────────────

const BATTLE_ROOMS = ['fight', 'elite', 'siege', 'boss']
// A floor of seed `seed` as a run meets it: its map, every battle room's foes drawn, the routes varied.
export function floorOf (seed, floor) {
  const s = { seed, floor, map: generateFloor({ seed, floor, boss: bossPool(floor).length > 0 }) }
  for (const n of s.map.nodes) if (BATTLE_ROOMS.includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
  varyRoutes(s)
  return s.map
}
// The chance a walk through `map` stands in each room, each fork taken evenly. → Map id → chance
export function visits (map) {
  const p = new Map([[map.start, 1]])
  for (const n of map.nodes.slice().sort((a, b) => a.rank - b.rank)) {
    const here = p.get(n.id) ?? 0
    for (const id of n.next) p.set(id, (p.get(id) ?? 0) + here / n.next.length)
  }
  return p
}
// The kinds a battle room offers: every foe of every wave but a boss.
const offered = (n) => new Set([...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)].map((f) => f.id).filter((id) => !unitDef(id).boss))
// Whether kind `id` counts toward synergy `syn` (a kin or role its rule needs).
const countsFor = (syn, id) => Object.entries(syn.needs).some(([axis, need]) => need[unitDef(id)[axis]] !== undefined)

// The availability table over the floors of seeds `<seed>-0`… (`runs`), each fork taken evenly (visits):
//   draws      each floor's share of a fight's, an elite's and a captain's draws by kind
//   battles    by floor, the expected battles on a walk, and by kind those offering it
//   draft      the expected draft picks offering each kind
//   recipes    each recipe's parts with their expected battles by floor and by floor 2; its `reach`, the least
//   synergies  each synergy's expected battles by floor 2 offering a kind of its kin or role
export function poolTable ({ runs = 256, seed = 'div' } = {}) {
  const floors = Array.from({ length: TUNING.run.floors }, (_, i) => i + 1)
  const norm = (p) => {
    const sum = p.weights.reduce((a, b) => a + b, 0)
    return Object.fromEntries(p.units.map((u, i) => [u.id, p.weights[i] / sum]))
  }
  const draws = floors.map((floor) => ({ floor, fight: norm(spawnPool(floor)), elite: norm(spawnPool(floor, TUNING.spawn.eliteTier)), captain: TUNING.spawn.cohort[floor - 1] > 0 ? norm(captainPool(floor)) : {} }))
  const battles = floors.map((floor) => ({ floor, battles: 0, kinds: {} }))
  const synergies = Object.fromEntries(SYNERGIES.map((x) => [x.id, 0]))
  for (let k = 0; k < runs; k++) {
    for (const floor of floors) {
      const map = floorOf(`${seed}-${k}`, floor)
      const at = battles[floor - 1]
      for (const [id, p] of visits(map)) {
        const n = nodeOf(map, id)
        if (!BATTLE_ROOMS.includes(n.type)) continue
        const kinds = offered(n)
        at.battles += p / runs
        for (const kind of kinds) at.kinds[kind] = (at.kinds[kind] ?? 0) + p / runs
        if (floor <= 2) for (const x of SYNERGIES) if ([...kinds].some((kind) => countsFor(x, kind))) synergies[x.id] += p / runs
      }
    }
  }
  const draft = {}
  const deal = (seed, held, p) => {
    if (held.length >= TUNING.draft.picks) return
    const offer = draftOffer(seed, held.length, held)
    for (const id of offer) {
      draft[id] = (draft[id] ?? 0) + p / runs
      deal(seed, [...held, id], p / offer.length)
    }
  }
  for (let k = 0; k < runs; k++) deal(`${seed}-${k}`, [], 1)
  const by = (id, floor) => battles[floor - 1].kinds[id] ?? 0
  const byTwo = (id) => by(id, 1) + by(id, 2)
  const reachOf = (r) => Math.min(...Object.keys(r.needs).map((id) => (unitDef(id).fused ? Math.min(...FUSION_LIST.filter((x) => x.result === id).map(reachOf)) : byTwo(id))))
  const recipes = FUSION_LIST.map((r) => ({
    id: r.id,
    result: r.result,
    parts: Object.entries(r.needs).map(([id, need]) => ({ id, need, fused: !!unitDef(id).fused, floors: floors.map((f) => by(id, f)), byTwo: byTwo(id), draft: draft[id] ?? 0 })),
    reach: reachOf(r)
  }))
  return { runs, seed, draws, battles, draft, recipes, synergies }
}

export function poolLines (t) {
  const kinds = UNIT_LIST.filter((u) => u.spawn && !u.boss).sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1))
  const cell = (x) => (x ? pct(x, x < 0.1 ? 1 : 0) : '-').padStart(6)
  const out = [`the pool (spawnPool, tierFalloff ${TUNING.spawn.tierFalloff}, tierOverCap ${TUNING.spawn.tierOverCap}): each floor's share of a fight's (f), an elite's (e) and a fight's captain's (c, captainPool: from floor 2) draws, by kind`]
  out.push(`${'kind'.padEnd(16)}tier ${t.draws.map((d) => `${`f${d.floor}`.padStart(6)}${`e${d.floor}`.padStart(6)}${`c${d.floor}`.padStart(6)}`).join(' ')}`)
  for (const u of kinds) out.push(`${u.id.padEnd(16)}${String(u.tier).padStart(4)} ${t.draws.map((d) => `${cell(d.fight[u.id])}${cell(d.elite[u.id])}${cell(d.captain?.[u.id])}`).join(' ')}`)
  out.push('')
  out.push(`expected battles on a walk offering each kind (its foes among the slain), by floor (${t.runs} seeds ${t.seed}-0…, each fork`)
  out.push('taken evenly); and the draft\'s picks offering it')
  out.push(`${'kind'.padEnd(16)}${t.battles.map((b) => `fl ${b.floor}`.padStart(6)).join('')}  ${'by fl 2'.padStart(7)}  ${'draft'.padStart(5)}`)
  out.push(`${'(battles)'.padEnd(16)}${t.battles.map((b) => b.battles.toFixed(1).padStart(6)).join('')}  ${(t.battles[0].battles + t.battles[1].battles).toFixed(1).padStart(7)}`)
  for (const u of kinds) {
    const by = t.battles.map((b) => b.kinds[u.id] ?? 0)
    out.push(`${u.id.padEnd(16)}${by.map((x) => (x ? x.toFixed(2) : '-').padStart(6)).join('')}  ${(by[0] + by[1]).toFixed(2).padStart(7)}  ${(t.draft[u.id] ?? 0).toFixed(2).padStart(5)}`)
  }
  out.push('')
  out.push('recipes (criterion 1: the parts of each first fusion offered in 3 or more battles by the end of floor 2): each part\'s')
  out.push('expected battles by the end of floor 2 (by floor 1/2/3/4; the draft\'s picks), its reach the least of them')
  for (const r of t.recipes) {
    const parts = r.parts.map((p) => (p.fused ? `${p.need}× ${p.id} (fused)` : `${p.need}× ${p.id} ${p.byTwo.toFixed(1)} (${p.floors.map((x) => x.toFixed(1)).join('/')}${p.draft ? `; draft ${p.draft.toFixed(2)}` : ''})`)).join(', ')
    out.push(`  ${r.result.padEnd(26)} reach ${r.reach.toFixed(1).padStart(4)}  ${(r.reach >= 3 ? 'met' : 'NOT MET').padEnd(8)}${parts}`)
  }
  out.push(`synergies: battles by the end of floor 2 offering a kind of its kin or role: ${Object.entries(t.synergies).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`)
  return out
}

// --pool: the table, printed. → the table
export function pool ({ runs = 256, seed = 'div', log = console.log } = {}) {
  const t = poolTable({ runs, seed })
  for (const line of poolLines(t)) log(line)
  return t
}
