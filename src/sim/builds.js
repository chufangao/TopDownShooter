// The harness (redesign.md §3, §6 Step 0): what builds a run can make, how often each is made, and how well a player
// committed to each one does. Offline only, like teach.js and outside.js: never imported by the game or the expert's play.
//
//   node src/sim/autoplay.js --builds [--player expert|teacher] [--commit <archetype>[,…]|all|none] [--scale 1]
//                            [--runs 256] [--seed div] [--from 0] [--workers n] [--out file.json]   (npm run builds)
// plays seeds `<seed>-<from>`…: free play (the player as it ships) and, on the same seeds, the player committed to each
// archetype named (autoplay.js ARCHETYPES: every fused kind, every synergy; `all` every one, `none` free play alone; all
// by default), and prints a row an archetype (buildRows) and the diversity block of free play (diversity). The player:
// `expert` (LEVELS.expert, the instrument of the fast loop: ~8 s a run) or `teacher`, the outside teacher (outside.js:
// each out-of-battle choice among the expert's top six played out to the run's end by the expert, the first that clears
// taken; ~67 s a run), committed through the same book. `--scale`: every foe's HP and ATK × it (createRun's: the top of
// the ladder until §4.6 builds one). `--out`: every run's record as JSON.
//
//   node src/sim/autoplay.js --pool [--maps 64] [--seed pool]   (npm run pool)
// the availability table (poolTable): each floor's share of a fight's and an elite's draws by kind (spawnPool), the
// expected battles on a walk that offer each kind by floor (mapped over the floors of `--maps` seeds, the walk a uniform
// draw at each fork), and for every recipe each part's (criterion 1: three battles by the end of floor 2).
//
// Noise as the old spec reported it: ± one standard error of the paired difference; 64 seeds resolve ~6 points of clear
// rate, 256 ~3.
import fs from 'node:fs'
import { ARCHETYPES, record, pairedStats } from './autoplay.js'
import { outsideTeacher, outsideStats } from './outside.js'
import { spawnPool, drawRoom, varyRoutes, draftPool } from './run.js'
import { generateFloor, nodeOf } from './map.js'
import { TUNING } from '../tuning.js'
import { unitDef, UNIT_LIST, FUSION_LIST, SYNERGIES, relicDef } from '../content.js'

export const PLAYERS = Object.freeze(['expert', 'teacher'])
// The outside teacher as §3 uses it: every phase, the expert's top six, the first line that clears taken.
export const TEACHER = Object.freeze({ won: true, cap: 6 })

// ── a run ────────────────────────────────────────────────────────────────────────────────────────

// One run of the harness (a worker's job: autoplay.js playAll): seed `seed` played by `player`, committed to `commit`
// (null: free play), at difficulty `scale`. The expert's is autoplay.js record's; the teacher's the same record with the
// outside teacher choosing out of battle (outside.js outsideTeacher, TEACHER's settings) and the expert in battle, and its
// counts (`teacher`: decisions, playouts, overrides). → record's result
export function buildRecord ({ seed, player = 'expert', commit = null, scale = 1 }) {
  if (!PLAYERS.includes(player)) throw new Error(`unknown player "${player}": ${PLAYERS.join(', ')}`)
  if (player === 'expert') return record({ seed, level: 'expert', commit, scale })
  let last = null
  const act = (run, rng) => {
    last = run
    return outsideTeacher(run, rng, TEACHER)
  }
  return { ...record({ seed, level: 'expert', commit, scale, act }), player, teacher: last && teacherCounts(last) }
}
// The teacher's counts for its run (outside.js outsideStats, summed over the phases).
function teacherCounts (run) {
  const st = outsideStats(run)
  const sum = (k) => Object.values(st.phases).reduce((n, p) => n + p[k], 0)
  return { decisions: sum('decided'), playouts: sum('playouts'), overrides: sum('overrides') }
}

// The jobs of a --builds run: free play, then each archetype committed, on the same seeds.
export function buildJobs ({ player = 'expert', commits = ARCHETYPES(), scale = 1, runs = 256, seed = 'div', from = 0 }) {
  const seeds = Array.from({ length: runs }, (_, i) => `${seed}-${from + i}`)
  return [null, ...commits].flatMap((commit) => seeds.map((s) => ({ builds: true, seed: s, player, commit, scale })))
}

// ── what a group of runs made ────────────────────────────────────────────────────────────────────

const share = (n, d) => (d ? n / d : 0)
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs) => {
  if (!xs.length) return null
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
// Whether an archetype was reached in a run (autoplay.js builtOf: a fused kind of yours standing in a battle, a synergy
// your side held as one began), and the battle it first was.
const reachedIn = (r, arch) => r.built.reached[arch] ?? null

// A row of the --builds report for runs `R` (one archetype's, or free play's: `arch` null), against free play's `F` on
// the same seeds where given: runs, clears, mean progress (and its paired difference from free play's, ± one standard
// error), deaths by floor, the margin (redesign.md §3: the Monarch's and the souls' share of their HP at the end, battles
// lost, essence left, turns a battle, each a mean over the runs) and, for an archetype, the share of runs that reached it
// and the median battle it was first reached in.
export function buildRow (R, arch = null, F = null) {
  const battles = R.reduce((n, r) => n + r.battles.length, 0)
  const deaths = [1, 2, 3, 4].map((f) => R.filter((r) => r.result !== 'victory' && r.floor === f).length)
  const reached = arch ? R.map((r) => reachedIn(r, arch)).filter(Boolean) : []
  const paired = F ? pairedStats(F, R) : null
  return {
    arch,
    runs: R.length,
    clears: R.filter((r) => r.result === 'victory').length,
    progress: 100 * mean(R.map((r) => r.progress)),
    diff: paired && arch ? paired.diff : null,
    se: paired && arch ? paired.se : null,
    deaths,
    monarch: 100 * mean(R.map((r) => r.end.monarch)),
    souls: 100 * mean(R.map((r) => r.end.souls)),
    lost: R.reduce((n, r) => n + r.end.lost, 0),
    essence: mean(R.map((r) => r.end.essence)),
    turns: share(R.reduce((n, r) => n + r.end.turns, 0), battles),
    reached: arch ? share(reached.length, R.length) : null,
    first: arch ? median(reached.map((x) => x.first)) : null,
    secs: mean(R.map((r) => r.secs))
  }
}

// What a group of runs made, for the diversity block (redesign.md §2, criterion 3), each a share: of the runs, each
// archetype reached at all (`archetypes`), each fused kind held at the end (`fused`: the final army's), each recipe made
// (`made`, with the fusions made in all: `fusions`); of the battles, each synergy your side held as it began
// (`synergies`); of the final armies, each kind held (`kinds`); of the souls fielded at the end, each role and kin
// (`roles`, `kins`); of the relics bought, each relic (`relics`), with relics a run (`perRun`) and the Command relics'
// share (`command`).
export function diversity (R) {
  const n = R.length
  const battles = R.flatMap((r) => r.battles)
  const count = (keys) => {
    const out = {}
    for (const k of keys) out[k] = (out[k] ?? 0) + 1
    return out
  }
  const runsWith = (f) => count(R.flatMap((r) => [...new Set(f(r))]))
  const shares = (o, d) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => [k, share(v, d)]))
  const fielded = R.flatMap((r) => r.built.army.filter(([, on]) => on).map(([id]) => unitDef(id)))
  const bought = R.flatMap((r) => r.built.bought)
  const command = (id) => (relicDef(id).mods ?? []).some((m) => m.path === 'run.command' && m.v > 0)
  return {
    runs: n,
    battles: battles.length,
    archetypes: shares(runsWith((r) => Object.keys(r.built.reached)), n),
    fused: shares(runsWith((r) => r.built.army.map(([id]) => id).filter((id) => unitDef(id).fused)), n),
    made: shares(runsWith((r) => Object.keys(r.built.made)), n),
    fusions: Object.fromEntries(FUSION_LIST.map((x) => [x.id, R.reduce((k, r) => k + (r.built.made[x.id] ?? 0), 0)])),
    synergies: shares(count(battles.flatMap((b) => b.syn ?? [])), battles.length),
    kinds: shares(runsWith((r) => r.built.army.map(([id]) => id)), n),
    roles: shares(count(fielded.map((u) => u.role)), fielded.length),
    kins: shares(count(fielded.map((u) => u.kin)), fielded.length),
    relics: shares(count(bought), bought.length),
    perRun: share(bought.length, n),
    command: share(bought.filter(command).length, bought.length)
  }
}

// Criterion 3 read off a diversity block: the most common fused kind's share of final armies (at most 30%), the recipes
// made in fewer than 8% of runs (none), the synergies held in 5% or more of battles (six or more of the eleven), and the
// kinds held in a tenth of final armies or more. (Its fourth line, the relics ablation worth 10 points, is --ablations'.)
export function diversityChecks (d) {
  const topFused = Object.entries(d.fused)[0] ?? ['-', 0]
  const rare = FUSION_LIST.filter((x) => (d.made[x.id] ?? 0) < 0.08).map((x) => x.id)
  const synergies = SYNERGIES.filter((x) => (d.synergies[x.id] ?? 0) >= 0.05).map((x) => x.id)
  const kinds = Object.entries(d.kinds).filter(([, v]) => v >= 0.1).map(([k]) => k)
  return {
    topFused: { id: topFused[0], share: topFused[1], ok: topFused[1] <= 0.3 },
    rareRecipes: { ids: rare, ok: !rare.length },
    synergies: { ids: synergies, ok: synergies.length >= 6 },
    kinds: { ids: kinds, of: UNIT_LIST.filter((u) => u.spawn || u.fused).length }
  }
}

// ── the report ───────────────────────────────────────────────────────────────────────────────────

const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`
const fmtShares = (o, top = Infinity, d = 0) => Object.entries(o).slice(0, top).map(([k, v]) => `${k} ${pct(v, d)}`).join(', ') || '-'

// The rows of a --builds report as lines: free play first, then each archetype, best progress first.
export function buildLines (rows, { player, scale, seeds }) {
  const out = [`builds: ${player}, ${seeds}${scale !== 1 ? `, foes ×${scale}` : ''}; each archetype committed (its book's combos alone) on free play's seeds`]
  out.push(`${'archetype'.padEnd(16)} ${'clears'.padStart(7)} ${'progress'.padStart(8)} ${'vs free'.padStart(14)}  ${'died fl 1/2/3/4'.padStart(15)}  ${'mon'.padStart(4)} ${'souls'.padStart(5)} ${'lost'.padStart(4)} ${'ess'.padStart(5)} ${'t/b'.padStart(5)}  ${'reached'.padStart(7)} ${'at'.padStart(4)}  ${'s/run'.padStart(5)}`)
  for (const r of rows) {
    const vs = r.diff === null ? '' : `${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)} ± ${r.se.toFixed(1)}`
    out.push([
      (r.arch ?? 'free play').padEnd(16),
      pct(r.clears / r.runs, 1).padStart(7),
      r.progress.toFixed(1).padStart(8),
      vs.padStart(14),
      ' ' + r.deaths.join('/').padStart(15),
      ' ' + r.monarch.toFixed(0).padStart(4),
      r.souls.toFixed(0).padStart(5),
      String(r.lost).padStart(4),
      r.essence.toFixed(0).padStart(5),
      r.turns.toFixed(1).padStart(5),
      ' ' + (r.reached === null ? '' : pct(r.reached)).padStart(7),
      String(r.first ?? '').padStart(4),
      ' ' + r.secs.toFixed(1).padStart(5)
    ].join(' '))
  }
  out.push('  mon, souls: the Monarch\'s and the souls\' share of their HP at the end (%); lost: battles lost; ess: essence left;')
  out.push('  t/b: turns a battle; reached: runs that fielded its fused kind or held its synergy; at: the median battle it first was')
  return out
}

// The diversity block as lines (free play's; the ladder's for each level).
export function diversityLines (d, label = 'free play') {
  const c = diversityChecks(d)
  const ok = (x) => (x ? 'ok' : 'NOT MET')
  return [
    `diversity, ${label} (${d.runs} runs, ${d.battles} battles):`,
    `  archetypes reached (runs)  ${fmtShares(d.archetypes)}`,
    `  fused kinds at the end     ${fmtShares(d.fused)}   [none above 30%: ${ok(c.topFused.ok)}]`,
    `  recipes made (runs)        ${FUSION_LIST.map((x) => `${x.id} ${pct(d.made[x.id] ?? 0)} (${d.fusions[x.id]})`).join(', ')}   [each 8%+: ${ok(c.rareRecipes.ok)}]`,
    `  synergies (battles)        ${SYNERGIES.map((x) => `${x.id} ${pct(d.synergies[x.id] ?? 0)}`).join(', ')}   [six 5%+: ${c.synergies.ids.length}, ${ok(c.synergies.ok)}]`,
    `  kinds at the end (runs)    ${fmtShares(d.kinds, 14)}   [${c.kinds.ids.length} of ${c.kinds.of} in a tenth or more]`,
    `  fielded at the end         roles: ${fmtShares(d.roles)}; kins: ${fmtShares(d.kins)}`,
    `  relics bought              ${d.perRun.toFixed(1)} a run, Command ${pct(d.command)}: ${fmtShares(d.relics, 8)}`
  ]
}

// --builds: plays the jobs (autoplay.js playAll), prints the rows and free play's diversity block; with `out`, every
// record and the rows as JSON. → { rows, diversity, records }
export async function builds ({ playAll, player = 'expert', commits = ARCHETYPES(), scale = 1, runs = 256, seed = 'div', from = 0, out = null, log = console.log }) {
  const t0 = Date.now()
  const jobs = buildJobs({ player, commits, scale, runs, seed, from })
  const played = await playAll(jobs)
  const free = played.slice(0, runs)
  const rows = [buildRow(free)]
  commits.forEach((arch, k) => rows.push(buildRow(played.slice((k + 1) * runs, (k + 2) * runs), arch, free)))
  rows.splice(1, rows.length - 1, ...rows.slice(1).sort((a, b) => b.progress - a.progress || (a.arch < b.arch ? -1 : 1)))
  const d = diversity(free)
  const seeds = `${runs} seeds ${seed}-${from}…${seed}-${from + runs - 1}`
  for (const line of [...buildLines(rows, { player, scale, seeds }), '', ...diversityLines(d)]) log(line)
  log(`(${((Date.now() - t0) / 60000).toFixed(1)} min)`)
  if (out) fs.writeFileSync(out, JSON.stringify({ player, scale, seed, from, runs, commits, rows, diversity: d, records: played }) + '\n')
  return { rows, diversity: d, records: played }
}

// ── the pool ─────────────────────────────────────────────────────────────────────────────────────

const BATTLES = ['fight', 'elite', 'boss', 'siege']
// A room's kinds: every foe of every wave (all are slain when it is won, and each kind slain is a soul on offer).
const kindsOf = (n) => new Set([...(n.foes ?? []), ...(n.waves ?? []).flatMap((w) => w.foes)].map((f) => f.id))

// A floor of seed `seed` as a run meets it (run.js enterFloor): the map, every battle room's foes drawn, the routes varied.
export function floorOf (seed, floor) {
  const s = { seed, floor, map: generateFloor({ seed, floor, last: floor === TUNING.run.floors }) }
  for (const n of s.map.nodes) if (BATTLES.includes(n.type)) Object.assign(n, drawRoom(seed, floor, n))
  varyRoutes(s)
  return s.map
}

// The chance a walk through `map` stands in each room, the walk taking each fork evenly. → Map id → chance
export function visits (map) {
  const p = new Map([[map.start, 1]])
  const order = map.nodes.slice().sort((a, b) => a.rank - b.rank)
  for (const n of order) {
    const here = p.get(n.id) ?? 0
    for (const id of n.next) p.set(id, (p.get(id) ?? 0) + here / n.next.length)
  }
  return p
}

// The availability table (redesign.md §1, §4.2): `draws`, each floor's share of a fight's and an elite's draws by kind
// (spawnPool's weights, each pool summing to one); `battles`, by floor, the expected battles on a walk and, by kind, the
// expected battles on it whose foes include that kind (over the floors of `maps` seeds); `draft`, the expected picks of
// the draft that offer each kind; `recipes`, for each recipe each part's expected battles by floor and by the end of floor
// 2, with the least of its parts' (`reach`: criterion 1 asks three or more); `kins` and `roles`, the expected battles
// offering a kind of each by the end of floor 2.
export function poolTable ({ maps = 64, seed = 'pool' } = {}) {
  const floors = Array.from({ length: TUNING.run.floors }, (_, i) => i + 1)
  const norm = (p) => {
    const sum = p.weights.reduce((a, b) => a + b, 0)
    return Object.fromEntries(p.units.map((u, i) => [u.id, p.weights[i] / sum]))
  }
  const draws = floors.map((floor) => ({ floor, fight: norm(spawnPool(floor)), elite: norm(spawnPool(floor, TUNING.spawn.eliteTier)) }))
  const battles = floors.map((floor) => {
    let total = 0
    const kinds = {}
    for (let k = 0; k < maps; k++) {
      const map = floorOf(`${seed}-${k}`, floor)
      for (const [id, p] of visits(map)) {
        const n = nodeOf(map, id)
        if (!BATTLES.includes(n.type)) continue
        total += p
        for (const kind of kindsOf(n)) kinds[kind] = (kinds[kind] ?? 0) + p
      }
    }
    for (const kind of Object.keys(kinds)) kinds[kind] /= maps
    return { floor, battles: total / maps, kinds }
  })
  const pool = draftPool()
  const draft = Object.fromEntries(pool.map((id) => [id, TUNING.draft.picks * Math.min(1, TUNING.draft.offer / pool.length)]))
  const by = (id, floor) => battles[floor - 1].kinds[id] ?? 0
  const upTo = (id, floor) => floors.filter((f) => f <= floor).reduce((n, f) => n + by(id, f), 0)
  const recipes = FUSION_LIST.map((r) => {
    const parts = Object.entries(r.needs).map(([id, need]) => ({ id, need, floors: floors.map((f) => by(id, f)), byTwo: upTo(id, 2), draft: draft[id] ?? 0 }))
    return { id: r.id, result: r.result, parts, reach: Math.min(...parts.map((p) => p.byTwo)) }
  })
  const offering = (pred) => {
    const kinds = UNIT_LIST.filter((u) => u.spawn && pred(u)).map((u) => u.id)
    // The expected battles offering one or more of them: each battle counted once (its kinds' union), so mapped again.
    let n = 0
    for (let k = 0; k < maps; k++) {
      for (const floor of [1, 2]) {
        const map = floorOf(`${seed}-${k}`, floor)
        for (const [id, p] of visits(map)) {
          const node = nodeOf(map, id)
          if (BATTLES.includes(node.type) && [...kindsOf(node)].some((x) => kinds.includes(x))) n += p
        }
      }
    }
    return n / maps
  }
  const kins = Object.fromEntries([...new Set(UNIT_LIST.filter((u) => u.spawn).map((u) => u.kin))].map((k) => [k, offering((u) => u.kin === k)]))
  const roles = Object.fromEntries([...new Set(UNIT_LIST.filter((u) => u.spawn).map((u) => u.role))].map((k) => [k, offering((u) => u.role === k)]))
  return { maps, seed, draws, battles, draft, recipes, kins, roles }
}

// The availability table as lines.
export function poolLines (t) {
  const floors = t.draws.map((d) => d.floor)
  const kinds = UNIT_LIST.filter((u) => u.spawn && !u.boss).sort((a, b) => a.tier - b.tier || (a.id < b.id ? -1 : 1))
  const cell = (x) => (x ? pct(x, x < 0.1 ? 1 : 0) : '-').padStart(6)
  const out = [`the pool: each floor's share of a fight's (f) and an elite's (e) draws, by kind (spawnPool; tierFalloff ${TUNING.spawn.tierFalloff}, tierOverCap ${TUNING.spawn.tierOverCap})`]
  out.push(`${'kind'.padEnd(18)}tier ${floors.map((f) => `${`f${f}`.padStart(6)}${`e${f}`.padStart(6)}`).join(' ')}`)
  for (const u of kinds) out.push(`${u.id.padEnd(18)}${String(u.tier).padStart(4)} ${t.draws.map((d) => `${cell(d.fight[u.id])}${cell(d.elite[u.id])}`).join(' ')}`)
  out.push('')
  out.push(`expected battles on a walk offering each kind (its foes among the slain), by floor (${t.maps} maps a floor, each fork taken evenly); the draft's picks offering it`)
  out.push(`${'kind'.padEnd(18)}${floors.map((f) => `fl ${f}`.padStart(6)).join('')}  ${'by fl 2'.padStart(7)}  ${'draft'.padStart(5)}`)
  out.push(`${'(battles a walk)'.padEnd(18)}${t.battles.map((b) => b.battles.toFixed(1).padStart(6)).join('')}`)
  for (const u of kinds) {
    const by = t.battles.map((b) => b.kinds[u.id] ?? 0)
    out.push(`${u.id.padEnd(18)}${by.map((x) => (x ? x.toFixed(2) : '-').padStart(6)).join('')}  ${(by[0] + by[1]).toFixed(2).padStart(7)}  ${(t.draft[u.id] ?? 0).toFixed(2).padStart(5)}`)
  }
  out.push('')
  out.push('recipes: each part\'s expected battles offering it by the end of floor 2 (and by floor), the least of them its reach [criterion 1: 3 or more]')
  for (const r of t.recipes) {
    const parts = r.parts.map((p) => `${p.need}× ${p.id} ${p.byTwo.toFixed(1)} (${p.floors.map((x) => x.toFixed(1)).join('/')}${p.draft ? `, draft ${p.draft.toFixed(2)}` : ''})`).join('; ')
    out.push(`  ${r.result.padEnd(16)} reach ${r.reach.toFixed(1).padStart(4)} ${r.reach >= 3 ? 'ok     ' : 'NOT MET'}  ${parts}`)
  }
  out.push(`kins: battles offering one by the end of floor 2: ${Object.entries(t.kins).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`)
  out.push(`roles: the same: ${Object.entries(t.roles).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')}`)
  return out
}

// --pool: the table, printed. → the table
export function pool ({ maps = 64, seed = 'pool', log = console.log } = {}) {
  const t = poolTable({ maps, seed })
  for (const line of poolLines(t)) log(line)
  return t
}

// The archetypes a --commit names: `all` every one, `none` none (free play alone), else a comma-separated list, each
// checked.
export function commitsOf (spec = 'all') {
  if (spec === 'all') return ARCHETYPES()
  if (spec === 'none') return []
  const list = spec.split(',').filter(Boolean)
  for (const a of list) if (!ARCHETYPES().includes(a)) throw new Error(`unknown archetype "${a}": ${ARCHETYPES().join(', ')}`)
  return list
}

