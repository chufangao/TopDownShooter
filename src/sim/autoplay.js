// A heuristic player for tests and balance runs: a policy that picks one action at a time for apply().
// Run directly for a balance report:  node src/sim/autoplay.js [--runs 200] [--seed sim]
// or for a report on how much the player's choices decide battles:  … --decisions [--runs 60]
import { createRng } from './rng.js'
import {
  baseStats, autoPlace, CENTRE_OUT, CAMP_SLOTS, CAMP_ROWS, campGrid, campOpen, wallTiles, steps, deployTile,
  tileAt, TILES, LANES, rowOf, colOf, rangeOf, isAllyShape
} from './unit.js'
import { createBattle, runBattle } from './battle.js'
import { createRun, apply, availableNodes, mergeable, fieldCap, fielded, benched, currentNode, battleSetup } from './run.js'
import { TUNING } from '../tuning.js'
import { unitDef, abilityDef, campDef, ROLES } from '../content.js'

const hpPct = (u) => u.hp / u.maxHp
const partyHealth = (party) => party.reduce((n, u) => n + hpPct(u), 0) / party.length
const byPower = (a, b) => power(b) - power(a) || a.uid - b.uid

// Rough fighting worth: 0 for the fallen.
function power (u) {
  if (u.hp <= 0) return 0
  const s = baseStats(u.id, u.lvl, u.star)
  return Math.sqrt(s.hp * s.atk)
}

function pickNode (run, rng) {
  const nodes = availableNodes(run)
  const health = partyHealth(run.state.party)
  const w = { fight: 3, elite: health > 0.7 ? 1.5 : 0.3, reliquary: 2, altar: health < 0.6 ? 5 : 0.5, boss: 1 }
  return { type: 'node', id: rng.weighted(nodes, nodes.map((n) => w[n.type])).id }
}

// ── prep: the formation ──────────────────────────────────────────────────────────────────────────

// The autoplayer arranges its souls with the same choice a player has: any open camp cell. It drafts a
// few formations and rehearses each against the scouted foes on a different battle seed (it knows the
// rules, not the rolls), keeping the one that does best; ties keep the earlier draft:
//   rows       each role's row, packed from the middle lane (bonds and auras want neighbours)
//   spread     each role's row, every other lane first (against area attacks)
//   sheltered  the melee where foes walking in arrive first; ranged souls behind the walls, where foes
//              must walk furthest to reach them for how close they stand

const SPREAD = [3, 1, 5, 2, 4, 0, 6]
const blasts = (foes) => foes.some((f) => unitDef(f.id).abilities.some((id) => abilityDef(id).shape === 'blast'))
const reachOf = (u) => Math.max(1, ...unitDef(u.id).abilities.map(abilityDef).filter((a) => !isAllyShape(a.shape)).map(rangeOf))

// How many steps a foe needs from the open ground above the camp to each camp cell, around its walls.
function walkIn (camp) {
  const walls = new Set(wallTiles(camp))
  const dist = new Array(TILES).fill(Infinity)
  const queue = []
  for (let x = 0; x < LANES; x++) queue.push(tileAt(x, CAMP_ROWS))
  for (const t of queue) dist[t] = 0
  for (let i = 0; i < queue.length; i++) {
    for (const n of steps(queue[i], walls)) {
      if (dist[n] === Infinity) { dist[n] = dist[queue[i]] + 1; queue.push(n) }
    }
  }
  return (slot) => dist[deployTile('party', slot)]
}

function sheltered (units, camp) {
  const walk = walkIn(camp)
  const free = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(camp, slot))
  const lane = (slot) => CENTRE_OUT.indexOf(colOf(slot))
  const melee = (u) => reachOf(u) === 1
  const row = (u) => ROLES[unitDef(u.id).role].autoRow
  const order = units.slice().sort((a, b) => melee(b) - melee(a) || row(a) - row(b))
  for (const u of order) {
    const off = (slot) => Math.abs(rowOf(slot) - row(u))
    const score = melee(u) ? (slot) => walk(slot) : (slot) => -(walk(slot) - rowOf(slot) - 1)
    free.sort((a, b) => score(a) - score(b) || off(a) - off(b) || lane(a) - lane(b))
    u.slot = free.shift()
  }
  return units
}

function drafts (run, want) {
  const s = run.state
  const blank = () => want.map((u) => ({ ...u, slot: -1 }))
  const rows = (cols) => autoPlace(blank(), { cols, grid: campGrid(s.camp) })
  const lanes = blasts(currentNode(run).foes) ? [SPREAD, CENTRE_OUT] : [CENTRE_OUT, SPREAD]
  return [rows(lanes[0]), rows(lanes[1]), sheltered(blank(), s.camp)]
}

// A rehearsal's worth: a win by how much HP it keeps (wounds carry over), a loss by how much of the
// foes' HP it took.
function rehearse (run, party) {
  const setup = battleSetup(run, { party })
  const b = createBattle({ ...setup, seed: setup.seed + '|rehearsal' })
  runBattle(b)
  const share = (side) => {
    const us = b.units.filter((u) => u.side === side)
    return us.reduce((n, u) => n + u.hp, 0) / us.reduce((n, u) => n + u.maxHp, 0)
  }
  return b.winner === 'party' ? 1 + share('party') : -share('foe')
}

// Drafts that put everyone in the same cells are only rehearsed once.
function plan (run, want) {
  let best = null
  let bestScore = -Infinity
  const seen = new Set()
  for (const party of drafts(run, want)) {
    const key = party.map((u) => u.slot).join()
    if (seen.has(key)) continue
    seen.add(key)
    const score = rehearse(run, party)
    if (score > bestScore) { best = party; bestScore = score }
  }
  return best.map((u) => ({ uid: u.uid, slot: u.slot }))
}

// The plan only depends on the room, the camp, the relics, who is fielded and the uids the foes will
// take, so it is made once per prep however many steps carry it out (and however many times something
// else moves a soul).
const plans = new WeakMap()
function planFor (run, want) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.camp, s.relics, s.nextUid, want.map((u) => [u.uid, u.id, u.lvl, u.star, u.hp])])
  const have = plans.get(run)
  if (have?.key === key) return have.plan
  const made = plan(run, want)
  plans.set(run, { key, plan: made })
  return made
}

// One step toward: merged where the field stays full, the strongest souls fielded, then each in its
// planned cell; then fight. Three bodies outfight one merged soul, so merging
// only pays once there are more souls than field slots.
function pickPrep (run) {
  const s = run.state
  const standing = s.party.filter((u) => u.hp > 0).length
  const m = mergeable(s.party)[0]
  if (m && standing - (TUNING.star.copies - 1) >= fieldCap(run)) return { type: 'merge', ...m }
  const field = fielded(s.party)
  const want = s.party.filter((u) => u.hp > 0).sort(byPower).slice(0, fieldCap(run))
  const missing = want.find((u) => u.slot < 0)
  if (missing) {
    if (field.length < fieldCap(run)) {
      const probe = { ...missing, slot: -1 }
      autoPlace([...field.map((u) => ({ ...u })), probe], { grid: campGrid(s.camp) })
      return { type: 'place', uid: missing.uid, slot: probe.slot }
    }
    const out = field.filter((u) => !want.includes(u)).sort(byPower).at(-1)
    return { type: 'place', uid: missing.uid, slot: out.slot }
  }
  // Each step puts one soul in its planned slot; whoever stood there takes its old one. A soul already
  // in place is never moved again, so this ends within one step per soul.
  const goal = planFor(run, want)
  const unit = (p) => s.party.find((u) => u.uid === p.uid)
  const off = goal.find((p) => unit(p).slot !== p.slot)
  if (off) return { type: 'place', uid: off.uid, slot: off.slot }
  return { type: 'fight' }
}

// Relics first, then the soul closest to a merge (or of the highest tier); a full retinue releases
// its weakest benched soul to make room.
function pickReap (run) {
  const s = run.state
  const relic = s.offers.findIndex((o) => o.type === 'relic')
  if (relic >= 0) return { type: 'reap', index: relic }
  if (!s.offers.length) return { type: 'reap', index: null }
  const copies = (id) => s.party.filter((u) => u.id === id && u.star === 1).length
  const score = (o) => copies(o.id) * 10 + unitDef(o.id).tier
  const best = s.offers.map((o, index) => ({ o, index })).sort((a, b) => score(b.o) - score(a.o) || a.index - b.index)[0]
  if (s.party.length < TUNING.party.roster) return { type: 'reap', index: best.index }
  const weakest = benched(s.party).sort(byPower).at(-1)
  return weakest ? { type: 'release', uid: weakest.uid } : { type: 'reap', index: null }
}

export function policy (run, rng) {
  const s = run.state
  if (s.phase === 'map') return pickNode(run, rng)
  if (s.phase === 'prep') return pickPrep(run)
  if (s.phase === 'reap') return pickReap(run)
  throw new Error(`no policy for phase "${s.phase}"`)
}

// Plays the run to the end. onBattle(battle, run) fires after each battle, once the run has moved on.
export function autoplay (run, { rng = createRng(run.state.seed).stream('autoplay'), onBattle = null } = {}) {
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e5) throw new Error('autoplay is stuck')
    const action = policy(run, rng)
    apply(run, action)
    if (action.type === 'fight') onBattle?.(run.battle, run)
  }
  return run
}

// ── balance report ─────────────────────────────────────────────────────────────────────────────

// Autoplays `runs` seeded runs and prints clear rate, battle length, per-floor progression and how each camp layout fares: a camp far off its floor's average is a balance outlier.
function report ({ runs, seed: seed0 }) {
  const ticks = []
  const deaths = {}
  const floors = {} // floor (B = boss) → sums at the start of each battle there
  const camps = {} // camp id → { battles, won, ended: runs lost in it }
  let clears = 0
  let reaped = 0
  let merges = 0
  let ceiling = 0
  for (let i = 0; i < runs; i++) {
    const seed = `${seed0}-${i}`
    const run = createRun({ seed })
    autoplay(run, {
      rng: createRng(seed).stream('autoplay'),
      onBattle: (b) => {
        ticks.push(b.t)
        if (b.reason === 'tick-ceiling') ceiling++
        const party = b.units.filter((u) => u.side === 'party')
        const foes = b.units.filter((u) => u.side === 'foe')
        const f = (floors[b.floor + (b.boss ? 'B' : '')] ??= { n: 0, lvl: 0, star: 0, size: 0, roster: 0, foes: 0, relics: 0, won: 0 })
        f.n++
        f.lvl += party.reduce((n, u) => n + u.lvl, 0) / party.length
        f.star += party.reduce((n, u) => n + u.star, 0) / party.length
        f.size += party.length
        f.roster += run.state.party.length
        f.foes += foes.length
        f.relics += run.state.relics.length
        f.won += b.winner === 'party' ? 1 : 0
        const c = (camps[run.state.camp] ??= { battles: 0, won: 0, ended: 0 })
        c.battles++
        c.won += b.winner === 'party' ? 1 : 0
      }
    })
    const s = run.state
    if (s.result === 'defeat') camps[s.camp].ended++
    if (s.result === 'victory') clears++
    else deaths[s.floor] = (deaths[s.floor] ?? 0) + 1
    reaped += s.stats.reaped
    merges += s.stats.merges
  }

  ticks.sort((a, b) => a - b)
  const q = (p) => ticks[Math.min(ticks.length - 1, Math.floor(p * ticks.length))]
  const pct = (n) => `${(100 * n / runs).toFixed(1)}%`
  console.log(`runs ${runs} (seed ${seed0})`)
  console.log(`clear rate        ${pct(clears)}`)
  for (let f = 1; f <= TUNING.run.floors; f++) console.log(`deaths on floor ${f} ${pct(deaths[f] ?? 0)}`)
  console.log(`battles           ${ticks.length}, ${(ticks.length / runs).toFixed(1)} per run`)
  console.log(`battle ticks      median ${q(0.5)}, p90 ${q(0.9)}, max ${ticks.at(-1)}, at ceiling ${ceiling}`)
  console.log(`mean souls reaped ${(reaped / runs).toFixed(2)}`)
  console.log(`mean merges       ${(merges / runs).toFixed(2)}`)
  console.log('\nper floor, averaged over battles fought there (retinue as it entered the battle):')
  console.log('floor  battles  won    field lvl  stars  fielded  roster  foes  relics')
  for (const [k, f] of Object.entries(floors)) {
    const avg = (v, d = 1) => (v / f.n).toFixed(d)
    console.log(`${k.padEnd(5)}  ${String(f.n).padStart(7)}  ${pct(f.won * runs / f.n).padStart(5)}  ${avg(f.lvl).padStart(9)}  ${avg(f.star, 2).padStart(5)}  ${avg(f.size).padStart(7)}  ${avg(f.roster).padStart(6)}  ${avg(f.foes).padStart(4)}  ${avg(f.relics).padStart(6)}`)
  }
  console.log('\nper camp (battles fought in it; runs that ended there in defeat):')
  console.log('floor  camp               battles  won     defeats')
  for (const [id, c] of Object.entries(camps).sort((a, b) => campDef(a[0]).floor - campDef(b[0]).floor || a[0].localeCompare(b[0]))) {
    console.log(`${String(campDef(id).floor).padEnd(5)}  ${campDef(id).name.padEnd(17)}  ${String(c.battles).padStart(7)}  ${(100 * c.won / c.battles).toFixed(1).padStart(5)}%  ${String(c.ended).padStart(7)}`)
  }
}

// ── decisions report ─────────────────────────────────────────────────────────────────────────────

// How much the player's formation decides battles: every battle the autoplayer fights is fought again
// `tries` times with its souls in random open cells. A choice that never changes the result is
// cosmetic; one that always does makes a bad pick an automatic loss. Aim for the share decided by the
// cells to sit around 30–40% on floors 2–4. Most fights are wins either way, so HP kept (the share of
// the field's HP still standing at the end, 0 for a loss) shows what a formation is worth when it is
// not the result: wounds carry over to the next fight.
function decisions ({ runs, seed: seed0, tries = 8 }) {
  const setups = []
  for (let i = 0; i < runs; i++) {
    const run = createRun({ seed: `${seed0}-${i}` })
    autoplay(run, { onBattle: (b, r) => setups.push(r.setup) })
  }
  const rng = createRng(seed0).stream('decisions')
  const floors = {}
  const KEYS = ['n', 'auto', 'random', 'decided', 'autoHp', 'randomHp', 'spreadHp']
  for (const setup of setups) {
    const fight = (party) => {
      const b = createBattle({ ...setup, party })
      runBattle(b)
      const mine = b.units.filter((u) => u.side === 'party')
      const hp = b.winner === 'party' ? mine.reduce((n, u) => n + u.hp, 0) / mine.reduce((n, u) => n + u.maxHp, 0) : 0
      return { won: b.winner === 'party', hp }
    }
    const open = [...Array(CAMP_SLOTS).keys()].filter((slot) => campOpen(setup.camp, slot))
    const shuffle = (party) => {
      const cells = rng.shuffle(open)
      return party.map((u, j) => ({ ...u, slot: cells[j] }))
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
  console.log(`runs ${runs} (seed ${seed0}), ${all.n} battles, each refought ${tries}× with the souls in random cells`)
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

if (typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  if (process.argv.includes('--decisions')) decisions({ runs: Number(arg('runs', 60)), seed: arg('seed', 'sim') })
  else report({ runs: Number(arg('runs', 200)), seed: arg('seed', 'sim') })
}
