// The outside teacher (redesign.md §2.23, §6 "The ranker and the forest"): the teacher out of battle. Each choice the
// expert makes between battles (its formation, its tiers and fusions, its recruit, a Shop's relics, who holds a relic)
// is made by playing its candidates out, offline, the best taken. Offline only, like teach.js, teacher.js and the combo
// book: never imported by the expert's play code (policy.js, autoplay.js's play, the game); it measures how much the
// choices out of battle carry, and it is the teacher an out-of-battle expert would learn from.
//
// The base: the expert in use (autoplay.js policy at the 'expert' level: on master the forest of forest.js deciding in
// battle and the learned route walking). Every playout is the base's play from the candidate on; in battle the run is
// the base's too (the driver below), so what the outside teacher gains is its own.
//
// A playout of a candidate: the run's state copied (the expert's play is a pure function of it, as teach.js playRoute
// copies a run: a fresh 'autoplay' stream, which the expert reads for nothing it decides), the candidate's actions applied,
// and the base plays on to the run's end (`rooms` 0, the default), or until `rooms` rooms are done (teach.js's room count:
// back on the map from a room's battle or its Shop, or walked through an altar). Valued as teach.js values a room
// choice: to the end by routeEndValue (ROUTE_END_WEIGHTS: −10·(1 − the run's progress at its end) for a loss, + the rooms
// and floors cleared from the decision, + the Monarch's and the souls' share of their max HP at the end of a cleared
// run), a window by routeValue (ROUTE_WEIGHTS: −10 the run lost in it, −3 the Monarch's share lost, − the souls', + the
// essence earned in tier prices, + 1 a room done). A formation (below) is valued by the coming battle alone unless `prep`
// is 'run'. Deterministic: the same run gives the same playouts and the same choice.
//
// The decisions, in the order the base meets them (autoplay.js policy out of battle), each one where the base makes it:
//   hold     (map, prep, Shop) a piece relic waiting: each soul standing that may hold it (pickHold's options), and
//            keeping it (passing on: the base's next decision taken now). A soul fallen with relics gives them back:
//            the base's, a decision of one.
//   spend    (map, prep) each tier the purse affords (spendOptions), each fusion it can make (fusionOptions), and
//            stopping (passing on: the room walked into, or the formation's next step).
//   prep     (prep, once the base would place or fight) the formation: the base's own (planFor), then those the forest
//            out of battle reads (autoplay.js prepCandidates: the next best the base's plan met by the base's own order,
//            the tree's filters, then the static score, and the best of its drafts), each fielded and the coming battle
//            played out by the base from it, valued as teach.js values a battle option to its end (endValue: −10 lost,
//            else −3·the Monarch's share lost as carried, − the souls' share lost as carried, a fallen soul all of its
//            share, − 0.02 a round). `prep` 'run' plays it to the run's end instead. Chosen once a prep; its steps then walk to it (the base's own stepping,
//            pickPrep's, toward the formation chosen), and a tier bought before the fight makes it again, as it does the
//            base's plan.
//   recruit  (reap) each soul offered that the purse affords (a full retinue letting its weakest go first, as the base's
//            weighRecruits chooses that soul), and none.
//   shop     (Shop) each relic on the shelf the purse affords, and buying nothing (leaving).
// Each candidate list is the base's own pick first, then the rest in the base's own order (the growth search's score for
// holds and tiers, the sketch's gain for recruits, the gain an essence for relics, the formation's standing), at most
// `cap` (6) in all; a decision of one candidate spends no playout. The best value is taken, a tie to the base's pick
// (within 1e-9). Passing on is a candidate like any other: valued as the base's next decision taken now and the base
// after it, so the teacher at each decision plays the best of its candidates followed by the base: a rollout policy over
// the base, never worse than the base by the value it compares (the base's pick is always played out), where every
// decision is valued to the run's end (`prep` 'run'); a formation judged by its battle alone carries no such promise.
//
// With `won` (`--won`, to the end only): a cleared run is enough. The candidates are played in order and the first whose
// playout clears the run is taken (the base's, where its own line clears), the rest not played; a formation judged by
// its battle keeps the base's where the base's line from it clears the run (that line played to the end first). Clears
// and progress lose nothing by it (a clear's value is above every loss's), only the Monarch's and the souls' HP at the
// end of a clear; and once a line that clears is found the teacher walks it to the clear at the cost of a fight looked up
// a decision, the formations' battles included: it clears every seed the base clears (playing the base's run move for
// move), which the best-by-value teacher, its formations judged by their battles, does not promise.
//
// Cost: a playout to the end is the rest of a run (seconds), so the teacher keeps what it has played: each playout's
// boards at each fight it opens (the run's state but its log, hashed) with where the run ended from there; a later
// playout that opens a fight already played takes that end. The base's pick at a decision is often the line the last
// decision's choice was played out on, and the candidates of a decision taken a step earlier or later in one prep meet
// again at its fight, so most of a decision's playouts end at their first fight. Windows (`rooms` > 0) keep nothing.
//
// Its parts mirror the base's dispatch out of battle (autoplay.js policy, pickNode, pickPrep, pickShop: baseStep and
// prepStep below), so it can pass on a decision and drive a formation; test/outside.test.js holds baseStep to policy step
// for step. A purchase's candidates and the recruit's are autoplay.js's own (spendCandidates, recruitCandidates, ranked by
// grow's scores and the sketch's gain: the forest out of battle reads the same), the base's pick the expert's in use
// (spendPick, recruitPick); the holds' and the Shop's scores mirror grow's and buyFor's. A hook in autoplay.js (policy
// with a decision passed, or a formation given) would let them go.
//
//   npm run outside -- [--runs 64] [--seed sim] [--from 0] [--workers 2] [--out dir] [--phases prep,spend,recruit,shop,hold]
//                      [--cap 6] [--rooms 0] [--prep battle|run] [--won] [--report-only]
// plays seeds `<seed>-<from>`…`<seed>-<from + runs − 1>` (sim-0…sim-63 by default), each by the outside teacher (out of
// battle; the base in battle) and by the expert as it ships (teach.js expertRun: autoplay.js record), paired (teach.js
// pairedReport, and how often the teacher overrode the base, by phase). runs.jsonl in `--out` (the OS's temp directory,
// retinue-outside-<seed>, by default), a line a run: { seed, player ('outside' or 'expert'), result, floor, progress
// (autoplay.js progressOf), battles: { won, fought }, ms, and the teacher's decisions, playouts, decisionMs, phases (by
// phase: asked, decided, overrides, candidates, playouts, hits, ms, gain), settings, base }; manifest.json its settings
// (a stage gone on with must name the same), report.json the paired report. A stage stopped part way goes on from where it
// was (the seeds done skipped).
//   npm run outside -- --label [--runs 200] [--seed outl] [--from 0] [--workers 8] [--out dir] [--cap 6] [--spend 1] [--calm 0.25]
// [--formations 9] [--phases recruit,spend,prep] [--floors 1,1,1,1]
// labels the base's recruits, purchases and formations for the forest out of battle (outforest.js): see LABEL below.
//   npm run outside -- --reread <dir> --out <dir> [--workers 8]   a label set's reads made again (rereadRun).
//
// Measured (2026-10-12, the base the expert as it ships: forest round 3, the learned route; `--won`, every phase, cap 6,
// to the end; seeds sim-0…63, 2 workers beside the battle teacher's 8, 39 min): 63/64 clears (98.4%) against the shipped
// expert's 23/64 (35.9%), +40 −0; progress +0.377 ± 0.045 (0.992 against 0.616); battles won 3155/3156 against
// 1933/1974; its one loss on floor 2 (sim-27, 0.490 against the base's 0.246). 67 s a run against 6.3 s (51 s where the
// base clears: its run played once, then looked up; 76 s where it loses), 281 decisions a run, 1.06 playouts and 215 ms
// a decision, 141 fights played in playouts a run. It overrode the base in 136 of 18,011 decisions (formations 56 of
// 3,156, tiers and fusions 39 of 11,338, recruits 41 of 3,042, Shop relics 0 of 331, holds 0 of 144); of the 41 seeds
// the base lost, 20 cleared on a single override. One phase at a time (the same seeds and settings, the rest the base's;
// 10 to 31 min each): recruits 62/64 (+39 −0, progress +0.360 ± 0.044, 38 s a run), tiers and fusions 60/64 (+37 −0,
// +0.343 ± 0.043, 52 s), formations by their battle 48/64 (+25 −0, +0.219 ± 0.041, 32 s; 308 overrides in 2,680), Shop
// relics 30/64 (+7 −0, +0.042 ± 0.015, 12 s), holds 27/64 (+4 −0, +0.035 ± 0.015, 12 s). Why so much from so little:
// the game is exact and the runs are chaotic, so another tier or recruit early on makes every later battle another
// battle, and with its consequences known to the end one of a handful of such lines nearly always clears. What it shows
// is foresight of exact consequences, not a rule a reader of the board could learn: the overrides are few, each one of
// the base's own next best by its score. The best-by-value teacher (no `--won`) plays every candidate of every decision
// to the end, a clear's included: on the pilot its sim-0 had run over 10 min when it was stopped (2.4 min with `--won`),
// so it was not measured on 64 seeds.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  apply, availableNodes, currentNode, canPlace, canHold, canBuy, relicPrice, unheld, souls, fielded, inOssuary, isMonarch, soulCount,
  rosterCap, OSSUARY
} from './run.js'
import { createRng, hashString } from './rng.js'
import {
  LEVELS, policy, survey, planFor, plan, pickRoute, pickHold, grow, spendOptions, fusionOptions,
  pickReap, weighRecruits, buyFor, growthOf, sketch, saving, nextTier, held, tierRate, offerState, targetOf, targetKinds, byFieldPower,
  progressOf, routeRooms, ablatedRun, routeModel, ROUTE_LEARNED, spendCandidates, recruitCandidates, rankCandidates, outCandidates, spendPick, recruitPick, outsideRead,
  prepCandidates, prepRead, formationName, PREP_CAP, pickDraft
} from './autoplay.js'
import { outForestModel, outDecides } from './outforest.js'
import { splitOf } from './ranker.js'
import { value, expertModel } from './expert.js'
import { forestModel } from './forest.js'
import {
  routeEndValue, routeEndOf, routeValue, ROUTE_END_WEIGHTS, ROUTE_WEIGHTS, endTally, endValue, END_WEIGHTS, expertRun, pairedReport, closeOf
} from './teach.js'
import { TUNING } from '../tuning.js'

// The decisions it may make (`phases`), and its defaults: `cap` candidates a decision at most, the base's pick among
// them; `rooms` 0 to the run's end (else that many rooms on); `prep` 'battle' (a formation judged by its coming battle) or
// 'run' (to the run's end, as the rest); `won` false (true: a cleared run is enough, see the head of this file).
export const PHASES = Object.freeze(['prep', 'spend', 'recruit', 'shop', 'hold'])
export const PREPS = Object.freeze(['battle', 'run'])
export const DEFAULTS = Object.freeze({ phases: PHASES, cap: 6, rooms: 0, prep: 'battle', won: false })
const L = LEVELS.expert
const EPS = 1e-9
const r6 = (x) => Math.round(x * 1e6) / 1e6

// A configuration made whole: its phases a Set of known names, its cap a whole number, 1 or more.
export function configOf (cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const phases = typeof c.phases === 'string' ? c.phases.split(',').filter(Boolean) : [...c.phases]
  for (const p of phases) if (!PHASES.includes(p)) throw new Error(`unknown phase "${p}": ${PHASES.join(', ')}`)
  if (!(Number.isInteger(c.cap) && c.cap >= 1)) throw new Error(`cap ${c.cap}: a whole number, 1 or more`)
  if (!(Number.isInteger(c.rooms) && c.rooms >= 0)) throw new Error(`rooms ${c.rooms}: a whole number, 0 for the run's end`)
  if (!PREPS.includes(c.prep)) throw new Error(`prep ${c.prep}: one of ${PREPS.join(', ')}`)
  return { ...c, won: !!c.won && !(c.rooms > 0), phases: new Set(phases) }
}

// ── the base's dispatch out of battle (mirrors autoplay.js policy) ─────────────────────────────────

// A copy of a run between battles, as teach.js playRoute makes one.
const copyOf = (run) => ({ state: structuredClone(run.state), battle: null, setup: null })
// The base's plan's key (autoplay.js planFor's): what a formation depends on. A formation chosen for one key holds while
// the key does.
export const planKey = (run) => {
  const s = run.state
  return JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.maxHp, u.tracks, u.relics])])
}

// One step toward formation `goal` ([{ uid, slot }], the Monarch's among them) as the base steps toward its plan
// (autoplay.js pickPrep after its spending): the souls it leaves out to the ossuary; then a soul into its cell where it
// can go straight there; with none that can, a soul not yet in place to the ossuary, to clear the way; then fight.
export function prepStep (run, goal) {
  const s = run.state
  const want = goal.filter((p) => !isMonarch(p))
  const piece = (p) => s.party.find((u) => u.uid === p.uid)
  const out = fielded(souls(s.party)).find((u) => !want.some((p) => p.uid === u.uid && p.slot >= 0))
  if (out) return { type: 'place', uid: out.uid, slot: OSSUARY }
  const off = want.filter((p) => piece(p).slot !== p.slot)
  const next = off.find((p) => canPlace(run, piece(p), p.slot))
  if (next) return { type: 'place', uid: next.uid, slot: next.slot }
  const blocker = off.find((p) => piece(p).slot >= 0)
  if (blocker) return { type: 'place', uid: blocker.uid, slot: OSSUARY }
  return { type: 'fight' }
}

// The base's action out of battle (autoplay.js policy: pickNode, pickPrep, pickReap, pickShop), with a decision passed
// on (`skip`: 'hold' the relics given; 'spend' the relics and the purchases, as passing on spending follows the relics;
// 'shop' the relics and the Shop's buys) and in prep the formation `goal` walked to in place of the base's plan. With
// neither, the base's own action (the tests hold it to policy's).
export function baseStep (run, sit = survey(run, L), { skip = null, goal = null } = {}) {
  const s = run.state
  if (s.phase === 'draft') return pickDraft(run, L)
  if (s.phase === 'reap') return pickReap(run, L, sit)
  const hold = skip ? null : pickHold(run, L, sit)
  if (hold) return hold
  if (s.phase === 'shop') return (skip === 'shop' ? null : buyFor(run, L, sit)) ?? { type: 'leave' }
  if (s.phase !== 'map' && s.phase !== 'prep') throw new Error(`no step out of battle for phase "${s.phase}"`)
  const spend = skip === 'spend' ? null : spendPick(run, L, sit)
  if (spend) return spend
  if (s.phase === 'map') {
    const nodes = availableNodes(run)
    return { type: 'node', id: nodes.length > 1 ? pickRoute(run, sit) : nodes[0].id }
  }
  return prepStep(run, goal ?? planFor(run, L))
}

// ── values ───────────────────────────────────────────────────────────────────────────────────────

// Where a decision stands for the value to the run's end (teach.js routeEndValue's `before`): its floor, and the share of
// the route done (progressOf: on the map the room it stands on done, else the room it is in still to do).
const ZERO = Object.freeze({ share: 0, floor: 0 })
export function beforeOf (run) {
  const s = run.state
  const rank = currentNode(run)?.rank ?? 0
  return { floor: s.floor, share: progressOf({ result: null, floor: s.floor, rank: s.phase === 'map' ? rank + 1 : rank }) }
}
// A playout's end (routeEndValue from nowhere: its parts as from floor 0 and no room done) read from `before`: its parts
// (the rooms and the floors cleared from there), and valued by them.
const partsFrom = (end, before) => ({ ...end.parts, rooms: end.parts.rooms - before.share * routeRooms(), floors: end.parts.floors - before.floor })
const fromEnd = (end, before, w) => r6(routeEndOf(partsFrom(end, before), w))

// What a window's value reads of a run (teach.js runTally, mirrored: its floor, the Monarch's share of its max HP, the
// souls' HP over their max, the essence earned so far, the purse, the army's strength as a log, the share done on the
// map).
function tallyOf (run) {
  const s = run.state
  const m = s.party.find(isMonarch)
  let hp = 0
  let max = 0
  for (const u of souls(s.party)) {
    hp += Math.max(0, u.hp)
    max += u.maxHp
  }
  const share = s.phase === 'map' ? progressOf({ result: null, floor: s.floor, rank: (currentNode(run)?.rank ?? 0) + 1 }) : null
  return { floor: s.floor, m: Math.max(0, m.hp) / m.maxHp, own: max ? hp / max : 0, essence: s.stats.essence, purse: s.essence, power: Math.log(survey(run).strength), share }
}
// A room done as teach.js counts one: back on the map from a room's battle or its Shop, or walked through an altar; or
// the run over, the Monarch standing.
const roomDone = (was, now, action, run) => (now === 'over' ? !run.state.death : now === 'map' && (was !== 'map' || action.type === 'node'))

// The key of a run's board at a fight it opens: its state but its log, hashed (the base's play from there is a pure
// function of it).
const keyOf = (run) => {
  const { log, ...rest } = run.state
  return hashString(JSON.stringify(rest))
}

// The base's plan for the prep `run` stands in (autoplay.js planFor), kept by its key (planKey) across the copies the
// playouts make: planFor keeps it for a run object, and each copy is a run object of its own (a plan is a hill-climb, a
// fifth of a playout's time while each copy made its own). planFor's key is all a plan depends on, so the plan kept is
// the one the copy would make.
function planOf (run, m, key = planKey(run)) {
  if (!m.plans.has(key)) m.plans.set(key, planFor(run, L))
  return m.plans.get(key)
}

// One candidate played out from `run` (never touched): a copy, the candidate's `actions` applied (an illegal one leaves
// it out: −Infinity), then the base to the run's end (or `rooms` rooms), in the prep it stands in walking to the
// candidate's formation (`goal`), else to the one the teacher chose for this prep (`m.goal`), else the base's plan. With
// `battle`, to the coming battle's end only. To the end and to a battle's end, each fight it opens is looked up in the
// teacher's memory (`m.ends`, `m.battles`) and kept there with where it led. → { value, won (to the end: the run
// cleared), parts (to the end: routeEndValue's from the decision; to a battle's end: endValue's), hit (ended at a fight
// already played), fights (fights it opened and played) }
export function playout (run, cand, m, c, before, { battle = false } = {}) {
  const r = copyOf(run)
  try {
    for (const a of cand.actions ?? []) apply(r, a)
  } catch {
    return { value: -Infinity, hit: false, fights: 0, illegal: true }
  }
  const book = battle ? m.battles : c.rooms > 0 ? null : m.ends
  const w = c.rooms > 0 ? ROUTE_WEIGHTS : ROUTE_END_WEIGHTS
  let goal = cand.goal ? { key: planKey(run), party: cand.goal } : m.goal
  const rng = createRng(r.state.seed).stream('autoplay')
  const passed = []
  let start = null
  let end = null
  let hit = false
  let fights = 0
  let done = 0
  for (let guard = 0; ; guard++) {
    if (guard > 1e6) throw new Error(`${r.state.seed}: an outside playout is stuck`)
    const s = r.state
    if (s.phase === 'over') break
    let action
    if (s.phase === 'prep') {
      const key = planKey(r)
      action = baseStep(r, survey(r, L), { goal: goal && goal.key === key ? goal.party : planOf(r, m, key) })
    } else action = policy(r, rng, 'expert')
    if (action.type === 'fight') {
      goal = null
      if (book) {
        const k = keyOf(r)
        if (book.has(k)) {
          end = book.get(k)
          hit = true
          break
        }
        passed.push(k)
      }
      fights++
    }
    const was = s.phase
    apply(r, action)
    if (battle && action.type === 'fight') start = endTally(r.battle)
    if (battle && start && r.state.phase !== 'battle') {
      end = endValue(start, r.battle, END_WEIGHTS, r.battle.reason === 'stall')
      break
    }
    if (roomDone(was, r.state.phase, action, r)) done++
    if (c.rooms > 0 && !battle && done >= c.rooms && roomDone(was, r.state.phase, action, r)) break
  }
  m.stats.fights += fights
  if (battle) {
    for (const k of passed) book.set(k, end)
    return { value: end.value, parts: end.parts, hit, fights }
  }
  if (c.rooms > 0) return { value: routeValue(before.window, r, done, w).value, hit, fights }
  end ??= routeEndValue(ZERO, r, w)
  for (const k of passed) book.set(k, end)
  return { value: fromEnd(end, before, w), won: end.parts.won === 1, hit, fights, parts: Object.fromEntries(Object.entries(partsFrom(end, before)).map(([k, v]) => [k, r6(v)])) }
}

// ── the decisions ────────────────────────────────────────────────────────────────────────────────

// What names a candidate: the action it takes now (null: passing on), or for a recruit the actions it takes.
const idOf = (x) => JSON.stringify(x ?? null)
// One decision: each candidate (the base's first) played out, the best value taken, a tie to the base's. A decision of
// one candidate is the base's, no playout spent. With `won`, the first candidate whose playout clears the run is taken
// (the base's where its own does), the rest not played; and a formation judged by its battle keeps the base's where the
// base's line from it clears the run (that line played to the end first, `settled`). Counted in the teacher's stats by
// phase. → the candidate chosen
function choose (run, m, c, phase, cands, opts = {}) {
  const st = m.stats.phases[phase]
  st.asked++
  if (cands.length < 2) return cands[0]
  const t0 = performance.now()
  const before = { ...beforeOf(run), ...(c.rooms > 0 && !opts.battle && { window: tallyOf(run) }) }
  const count = (p) => {
    st.playouts++
    if (p.hit) st.hits++
    return p
  }
  if (c.won && opts.battle && count(playout(run, cands[0], m, c, before)).won) {
    st.settled++
    st.decided++
    st.candidates++
    st.ms += performance.now() - t0
    m.last = { phase, cands: [{ label: cands[0].label, value: null }], pick: cands[0].label, settled: true }
    return cands[0]
  }
  let best = null
  let played = 0
  for (const cand of cands) {
    const p = count(playout(run, cand, m, c, before, opts))
    cand.value = p.value
    cand.won = !!p.won
    played++
    if (best === null || p.value > best.value + EPS) best = cand
    if (c.won && p.won) break
  }
  if (played < cands.length) st.settled++
  st.decided++
  st.candidates += played
  if (best !== cands[0]) {
    st.overrides++
    m.stats.picks.push({ phase, floor: run.state.floor, rank: currentNode(run)?.rank ?? 0, base: cands[0].label, pick: best.label, from: cands[0].value, to: best.value, cleared: !!best.won })
  }
  if (Number.isFinite(best.value - cands[0].value)) st.gain += best.value - cands[0].value
  st.ms += performance.now() - t0
  m.last = { phase, cands: cands.slice(0, played).map((x) => ({ label: x.label, value: x.value })), pick: best.label }
  return best
}

// The growth search's score of a relic given, as grow weighs it (autoplay.js grow): what it adds to the field's
// strength and the book's worth; null, keeping it where it is. (A purchase's are grow's own: spendCandidates.)
function growScore (run, a) {
  const w = TUNING.expert.growth
  if (!a) return value({ strength: 0, book: 0, keep: 1, save: 0 }, w)
  const base = growthOf(run.state, L)
  const sim = copyOf(run)
  apply(sim, a)
  const v = growthOf(sim.state, L)
  return value({ strength: v.strength - base.strength, book: v.book - base.book, keep: 0, save: 0 }, w)
}

// The formation chosen for this prep, while its key holds (else none: the base's plan).
const goalOf = (run, m) => (m.goal && m.goal.key === planKey(run) ? m.goal.party : null)
// Passing on a decision: the base's next decision's action taken now (baseStep with `skip`), the formation chosen for
// the prep walked to.
const passOn = (run, m, sit, skip) => ({
  id: idOf(null), label: skip === 'hold' ? 'keep' : 'stop', take: null, actions: [baseStep(run, sit, { skip, goal: run.state.phase === 'prep' ? goalOf(run, m) ?? planOf(run, m) : null })]
})

// Each decision's list, read where the base would make it: → { act } where there is no decision (the base's action, a
// step already decided, or null where the base passes on to its next decision), else { phase, cands (ranked: the
// base's pick first), opts (playout's), then (the action the candidate chosen takes now, null to pass on) }.

// A relic given (pickHold's options: each piece relic waiting to each standing soul that may hold it), or kept. A soul
// fallen with relics gives them back: the base's unhold, no decision.
function holdList (run, m, c, sit) {
  const s = run.state
  const base = pickHold(run, L, sit)
  if (base?.type === 'unhold' || !c.phases.has('hold')) return { act: base }
  const ids = [...new Set(unheld(s))]
  const up = souls(s.party).filter((u) => u.hp > 0)
  const options = ids.flatMap((relic) => up.filter((u) => canHold(s, relic, u)).map((u) => ({ type: 'hold', relic, uid: u.uid })))
  if (!options.length) return { act: base }
  const keep = { ...passOn(run, m, sit, 'hold'), score: growScore(run, null) }
  const cands = [keep, ...options.map((a) => ({ id: idOf(a), label: `hold ${a.relic} ${a.uid}`, take: a, actions: [a], score: growScore(run, a) }))]
  return { phase: 'hold', cands: rankCandidates(cands, idOf(base), c.cap), then: (x) => x.take }
}

// A purchase (each tier the purse affords, each fusion it can make: autoplay.js spendCandidates, grow's scores), or
// stopping (passing on).
function spendList (run, m, c, sit) {
  const d = spendCandidates(run, L, sit)
  if (!d) return { act: null }
  const base = spendPick(run, L, sit)
  if (!c.phases.has('spend')) return { act: base }
  const stop = passOn(run, m, sit, 'spend')
  const cands = d.cands.map((x) => (x.actions.length ? { ...x, take: x.actions[0] } : { ...x, ...stop }))
  return { phase: 'spend', cands: rankCandidates(cands, idOf(base), c.cap), then: (x) => x.take }
}

// A relic off the Shop's shelf (each the purse affords), or leaving.
function shopList (run, m, c, sit) {
  const s = run.state
  const base = buyFor(run, L, sit) ?? { type: 'leave' }
  if (!c.phases.has('shop')) return { act: base }
  const sk = sketch(s, L)
  const leave = { id: idOf({ type: 'leave' }), label: 'leave', take: { type: 'leave' }, actions: [{ type: 'leave' }], score: tierRate(run, L, sk) }
  const cands = [leave]
  for (const [index, id] of s.shop.entries()) {
    if (!id || !canBuy(run, index)) continue
    const a = { type: 'buy', index }
    cands.push({ id: idOf(a), label: `buy ${id}`, take: a, actions: [a], score: (held({ ...s, ...offerState(s, { type: 'relic', id }) }, id, L) - sk) / relicPrice(run, id) })
  }
  return { phase: 'shop', cands: rankCandidates(cands, idOf(base), c.cap), then: (x) => x.take }
}

// The one recruit a battle allows: each soul offered the purse affords (a full retinue letting go first the soul the
// base's weighRecruits lets go: the weakest standing in the ossuary, never one its combo is built of while another will
// do), or none (autoplay.js recruitCandidates, the sketch's gain of each). A recruit after a release is two actions: the
// release now, the recruit at the next call (`m.recruit`).
function recruitList (run, m, c, sit) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (m.recruit?.key === key && m.recruit.next.length) return { act: m.recruit.next.shift() }
  const base = pickReap(run, L, sit)
  if (!c.phases.has('recruit')) return { act: base }
  const d = recruitCandidates(run, L, sit)
  // The base's: today's, or the forest's where one out of battle decides recruits (as it stands: once its release is
  // made, the recruit alone, as today's).
  const full = soulCount(s.party) >= rosterCap(run)
  const own = outDecides('recruit') ? idOf(recruitPick(run, L, sit).filter((a) => full || a.type !== 'release')) : d.today
  const cands = d.cands.map((x) => ({ ...x, take: x.actions[0] }))
  const then = (x) => {
    if (x.actions.length > 1) m.recruit = { key, next: x.actions.slice(1) }
    return x.actions[0]
  }
  return { phase: 'recruit', cands: rankCandidates(cands, own, c.cap), then }
}

// The formations a prep may field, at most `cap`: those the forest out of battle reads in play (autoplay.js
// prepCandidates: today's pick, then the plan's next best in today's order (the tree's filters, TREES.formation, then the
// static score), the last PREP_DRAFTS places the best of its drafts), the base's own (`own`, planFor's: today's, or the
// forest's where one decides the prep) first. → [{ id, label, goal: [{ uid, slot }], actions: [] }]
export function formationGoals (run, cap, own = planFor(run, L)) {
  const { cands } = prepCandidates(run, L, plan(run, L), { cap })
  const id = formationName(own)
  const base = cands.find((x) => x.id === id) ?? { id, goal: own }
  return [base, ...cands.filter((x) => x !== base)].slice(0, cap).map((x, i) => ({ id: x.id, label: i ? `formation ${i}` : 'formation', goal: x.goal, actions: [] }))
}

// The formation for this prep, chosen once a prep (while the plan's key holds), then walked to step by step.
function formationList (run, m, c) {
  const key = planKey(run)
  if (m.goal?.key === key) return { act: prepStep(run, m.goal.party) }
  if (!c.phases.has('prep')) return { act: prepStep(run, planOf(run, m, key)) }
  const cands = formationGoals(run, c.cap, planOf(run, m, key))
  const then = (x) => {
    m.goal = { key, party: x.goal }
    return prepStep(run, x.goal)
  }
  return { phase: 'prep', cands, opts: { battle: c.prep !== 'run' }, then }
}

// On the map, once the relics and the purse are seen to: the base's room.
const roomList = (run, m, c, sit) => ({ act: baseStep(run, sit, { skip: 'spend' }) })

// The draft's picks are the base's (autoplay.js pickDraft): no decision the teacher plays out.
const draftList = (run) => ({ act: pickDraft(run, L) })

// The decisions each phase meets, in the order the base meets them (autoplay.js pickDraft, pickNode, pickPrep, pickReap,
// pickShop).
const ORDER = { draft: [draftList], map: [holdList, spendList, roomList], prep: [holdList, spendList, formationList], reap: [recruitList], shop: [holdList, shopList] }

// The decisions at `run` in order, each made (`play`: its candidates played out, the best taken) or passed on, until
// one gives an action. Without `play`, the first decision met unmade: { phase, cands }, or { act } where none is met
// before an action. → { act } | { phase, cands }
function decideAt (run, m, c, sit, play = true) {
  for (const list of ORDER[run.state.phase]) {
    const d = list(run, m, c, sit)
    if (!d.cands) {
      if (d.act) return { act: d.act }
      continue
    }
    if (!play) return { phase: d.phase, cands: d.cands }
    const act = d.then(choose(run, m, c, d.phase, d.cands, d.opts))
    if (act) return { act }
  }
  throw new Error(`${run.state.seed}: no action in phase "${run.state.phase}"`)
}

// ── the teacher ──────────────────────────────────────────────────────────────────────────────────

// What the teacher keeps a run: the boards of the fights its playouts opened, each with where it led (to the run's
// end, `ends`; to the battle's end, `battles`), the base's plans by their key (`plans`: planOf), the formation chosen for
// the prep it stands in, the recruit to make after a release, and its counts.
const memos = new WeakMap()
const emptyPhase = () => ({ asked: 0, decided: 0, overrides: 0, candidates: 0, playouts: 0, hits: 0, settled: 0, ms: 0, gain: 0 })
function memoOf (run) {
  if (!memos.has(run)) {
    memos.set(run, {
      ends: new Map(), battles: new Map(), plans: new Map(), goal: null, recruit: null, last: null,
      stats: { phases: Object.fromEntries(PHASES.map((p) => [p, emptyPhase()])), picks: [], fights: 0, ms: 0 }
    })
  }
  const m = memos.get(run)
  if (m.ends.size > 200000) m.ends.clear()
  if (m.battles.size > 50000) m.battles.clear()
  if (m.plans.size > 20000) m.plans.clear()
  return m
}
// The teacher's counts for `run` (by phase: asked, decided (more than one candidate), overrides (another than the base's
// pick), candidates, playouts, hits (playouts that ended at a fight already played), settled (with `won`: decided by a
// cleared line before every candidate was played), ms, gain (the value over the base's pick, summed); each override
// (`picks`: its phase, floor and rank, the base's pick and the one taken, their values, and whether the one taken was
// played out to a clear); fights its playouts played; ms in all) and its last decision's candidates and values.
export function outsideStats (run) {
  const m = memoOf(run)
  return { ...m.stats, last: m.last }
}

// The outside teacher's action for `run` out of battle (in battle, or over, the base's: policy), `cfg` its
// configuration (configOf: `phases`, `cap`, `rooms`, `prep`). The decisions in the order the base meets them: a relic
// given, a purchase, then on the map the base's room, in prep the formation's step; in the reap the recruit; in a Shop a
// relic given, then a relic bought or leaving. Use it in place of autoplay.js policy out of battle; what it keeps for the
// run (outsideStats) lives as long as the run object does.
export function outsideTeacher (run, rng, cfg = {}) {
  const s = run.state
  if (s.phase === 'battle' || s.phase === 'over') return policy(run, rng, 'expert')
  const m = memoOf(run)
  const t0 = performance.now()
  try {
    return decideAt(run, m, configOf(cfg), survey(run, L)).act
  } finally {
    m.stats.ms += performance.now() - t0
  }
}

// The first decision the outside teacher meets at `run` (out of battle), its candidates listed in order (the base's
// first), none played out: → { phase, cands: [{ label, actions (applied by a playout), take, goal (a formation's) }] }, or
// { act } where the base's action (or a step decided before) stands with no decision.
export function candidatesAt (run, cfg = {}) {
  return decideAt(run, memoOf(run), configOf(cfg), survey(run, L), false)
}

// ── runs ─────────────────────────────────────────────────────────────────────────────────────────

// What played as the base: the expert's model, the forest in use (its name), the route (the learned tree's name, or
// 'hand'), the forest out of battle in use (its name).
const baseOf = () => ({ expert: expertModel()?.name ?? null, forest: forestModel()?.name ?? null, route: routeModel() ? routeModel().name ?? 'learned' : 'hand', learned: ROUTE_LEARNED, outforest: outForestModel()?.name ?? null })

// One run with the outside teacher out of battle and the base in battle. `battles`: stop once that many battles are over
// (0: the whole run); `log`: the run's log in the result. → { seed, player 'outside', result, floor, progress,
// battles: { won, fought }, ms, decisions, playouts, single, decisionMs, phases, fights, settings, base }
export function outsideRun (seed, cfg = {}) {
  const c = configOf(cfg)
  const t0 = performance.now()
  const run = ablatedRun(seed)
  const rng = createRng(run.state.seed).stream('autoplay')
  let won = 0
  let fought = 0
  let fell = null
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    const was = run.state.phase
    const action = was === 'battle' ? policy(run, rng, 'expert') : outsideTeacher(run, rng, c)
    apply(run, action)
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) {
      const x = closeOf(run)
      fought++
      if (x.won) won++
      else fell = x.fell
      if (c.battles && fought >= c.battles) break
    }
  }
  const s = run.state
  const st = outsideStats(run)
  const sum = (k) => PHASES.reduce((n, p) => n + st.phases[p][k], 0)
  return {
    seed, player: 'outside', result: s.result ?? null, floor: s.floor,
    progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
    battles: { won, fought }, ms: Math.round(performance.now() - t0),
    decisions: sum('decided'), playouts: sum('playouts'), single: sum('asked') - sum('decided'), decisionMs: Math.round(st.ms),
    phases: Object.fromEntries(PHASES.map((p) => [p, { ...st.phases[p], ms: Math.round(st.phases[p].ms), gain: r6(st.phases[p].gain) }])),
    fights: st.fights, picks: st.picks, settings: settingsOf(c), base: baseOf(),
    ...(c.log && { log: s.log })
  }
}

// The settings a run's line and the manifest record.
const settingsOf = (c) => ({ phases: PHASES.filter((p) => c.phases.has(p)), cap: c.cap, rooms: c.rooms, prep: c.prep, ...(c.won && { won: true }) })

// ── labels for the forest out of battle (outforest.js, redesign.md §2.25) ─────────────────────────

// `--label`: runs of the base (the expert as it ships, or in use), and at its decisions of `phases` every candidate
// played out on a copy of the run by the base: a recruit's and a purchase's to the run's end, valued as to the end
// (routeEndValue, from the decision), a formation's to its battle's end, valued as teach.js values a battle option to its
// end (endValue: −10 the battle lost, else the Monarch's and the souls' shares of their HP lost as the run carries them, a
// fallen soul all of its share, and 0.02 a round); its parts kept. The candidates are those the forest out of battle
// reads in play: at a recruit or a purchase autoplay.js outCandidates' (today's pick first, then the rest by today's own
// score, at most `cap`, and passing on: stopping played as passing on, the base's next decision taken now), at a prep
// autoplay.js prepCandidates' (today's formation first, then the plan's next best in today's order, at most `cap`, and
// the best of its drafts beside them); the base's own pick among them; each read as play reads it (autoplay.js
// outsideRead, prepRead). Every recruit is labelled; a purchase's decision met again in a prep unchanged but for its
// placements (the same purse, kinds, relics and souls) only the first time, and a purchase drawn (a hash of the seed and
// the log index) with chance `spend` where two or more purchases of different kinds (a fusion one) are among its
// candidates, else `calm`; a prep once a plan (planKey: a tier bought between its steps makes another), where the base
// would first place a soul or fight, drawn with its floor's chance (`floors`, floor 1's first, the last for every floor
// past them). A row weighs 1 / its chance (`wt`). A worker labels a whole run, so its fights' store (playout's) serves
// every decision of the run: the base's own line is played once, each candidate's from where it leaves it.
export const LABEL = Object.freeze({ cap: 6, formations: PREP_CAP, spend: 1, calm: 0.25, phases: 'recruit,spend', floors: Object.freeze([1]) })
const LABEL_PHASES = Object.freeze(['recruit', 'spend', 'prep'])
const labelDraw = (seed, at, phase) => parseInt(hashString(phase === 'prep' ? `outside-label|prep|${seed}|${at}` : `outside-label|${seed}|${at}`).slice(0, 8), 16) / 2 ** 32

// A labelling's settings made whole: its phases a list of known names, its floors' chances a list of numbers in (0, 1].
export function labelConfig (cfg = {}) {
  const lc = { ...LABEL, ...cfg }
  const phases = typeof lc.phases === 'string' ? lc.phases.split(',').filter(Boolean) : [...lc.phases]
  for (const p of phases) if (!LABEL_PHASES.includes(p)) throw new Error(`no labels for phase "${p}": ${LABEL_PHASES.join(', ')}`)
  const floors = typeof lc.floors === 'string' ? lc.floors.split(',').map(Number) : [...lc.floors]
  if (!floors.length || !floors.every((x) => x > 0 && x <= 1)) throw new Error(`floors ${floors}: each floor's chance in (0, 1]`)
  return { ...lc, phases, floors }
}
const floorChance = (floor, lc) => lc.floors[Math.min(floor, lc.floors.length) - 1]

// The recruit or purchase the base meets first at `run`, as the labels read it: { phase, cands (today's first:
// outsideRead's), plays (each candidate as a playout plays it), base (the base's pick's id) }, or null where the base
// meets none of two candidates or more (or meets the recruit a release has made way for, decided with the release).
function labelAt (run, m, c, sit) {
  const s = run.state
  if (!c.phases.size || (s.phase === 'reap' && s.log.at(-1)?.type === 'release')) return null
  const d = decideAt(run, m, c, sit, false)
  if (!d.cands || d.cands.length < 2) return null
  const list = d.phase === 'recruit' ? recruitCandidates(run, L, sit) : spendCandidates(run, L, sit)
  const cands = outCandidates(list, c.cap)
  const base = d.cands[0].id
  if (cands.length < 2 || !cands.some((x) => x.id === base)) return null
  const stop = d.phase === 'spend' ? passOn(run, m, sit, 'spend') : null
  return { phase: d.phase, cands, plays: cands.map((x) => ({ actions: d.phase === 'spend' && !x.actions.length ? stop.actions : x.actions })), base }
}

// The prep the base meets at `run`, as the labels read it: where the base's next step is the formation's (no relic to
// give and nothing to buy first), once a plan (`plans`, by planKey). → { phase 'prep', cands (prepCandidates', today's
// first), plays (each formation walked to and its battle fought), base (the base's formation's id: planFor's) }, or null
function prepAt (run, lc, sit, plans) {
  if (run.state.phase !== 'prep') return null
  const key = planKey(run)
  if (plans.has(key)) return null
  const step = baseStep(run, sit)
  if (step.type !== 'place' && step.type !== 'fight') return null
  plans.add(key)
  const base = formationName(planFor(run, L, sit))
  const { cands } = prepCandidates(run, L, plan(run, L), { cap: lc.formations })
  if (cands.length < 2 || !cands.some((x) => x.id === base)) return null
  return { phase: 'prep', cands, plays: cands.map((x) => ({ goal: x.goal, actions: [] })), base }
}

// A purchase decision's chance of a label (see LABEL): `spend` where two purchases of different kinds, or a fusion and
// another, are among its candidates, else `calm`.
function spendChance (cands, lc) {
  const kinds = new Set(cands.flatMap((x) => x.actions.map((a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.kind))))
  return kinds.size >= 2 ? lc.spend : lc.calm
}

// One run of the base on `seed`, labelled (see LABEL; `cfg`: cap, spend, calm, phases, floors). → { line (the run's:
// seed, player 'label', result, floor, progress, battles, ms, phases (by phase: met, drawn out, met again, labelled,
// candidates, playouts, hits, ms, beaten: another candidate's playout the better than the base's), rows, fights,
// settings, base), rows (labels.jsonl's: { seed, run, split, phase, floor, rank, at (the run's log index), wt, sit,
// options: [{ action, id, today, base, f, value, parts, won (to the end: the run cleared; a formation's: its battle
// won) }] }) }
export function labelRun (seed, cfg = {}) {
  const lc = labelConfig(cfg)
  const c = configOf({ phases: lc.phases.filter((p) => p !== 'prep').join(','), cap: lc.cap })
  const preps = lc.phases.includes('prep')
  const t0 = performance.now()
  const run = ablatedRun(seed)
  const rng = createRng(run.state.seed).stream('autoplay')
  const m = memoOf(run)
  const num = Number(String(seed).split('-').at(-1))
  const rows = []
  const seen = new Set()
  const plans = new Set()
  const counts = Object.fromEntries(lc.phases.map((p) => [p, { met: 0, undrawn: 0, again: 0, labelled: 0, candidates: 0, playouts: 0, hits: 0, ms: 0, beaten: 0 }]))
  let won = 0
  let fought = 0
  let fell = null
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    const s = run.state
    const was = s.phase
    if (was !== 'battle') {
      const sit = survey(run, L)
      for (const d of [labelAt(run, m, c, sit), preps ? prepAt(run, lc, sit, plans) : null]) {
        if (!d) continue
        const k = counts[d.phase]
        k.met++
        const key = d.phase === 'spend' ? JSON.stringify([s.floor, s.at, s.essence, s.kinds, s.relics, s.party.map((u) => [u.uid, u.hp, u.relics])]) : null
        const chance = d.phase === 'spend' ? spendChance(d.cands, lc) : d.phase === 'prep' ? floorChance(s.floor, lc) : 1
        if (key && seen.has(key)) k.again++
        else if (labelDraw(seed, s.log.length, d.phase) >= chance) k.undrawn++
        else {
          if (key) seen.add(key)
          const t1 = performance.now()
          const before = beforeOf(run)
          const battle = d.phase === 'prep'
          const ends = d.plays.map((x) => playout(run, x, m, c, before, { battle }))
          const read = battle ? prepRead(run, L, sit, d.cands) : outsideRead(run, L, sit, d.phase, d.cands)
          k.labelled++
          k.candidates += d.cands.length
          k.playouts += ends.length
          k.hits += ends.filter((p) => p.hit).length
          const b = d.cands.findIndex((x) => x.id === d.base)
          if (ends.some((p, i) => i !== b && p.value > ends[b].value + EPS)) k.beaten++
          k.ms += performance.now() - t1
          rows.push({
            seed, run: num, split: splitOf(num), phase: d.phase, floor: s.floor, rank: currentNode(run)?.rank ?? 0, at: s.log.length, wt: r6(1 / chance), sit: read.sit,
            options: d.cands.map((x, i) => ({ action: x.label, id: x.id, today: i === 0, base: x.id === d.base, f: read.f[i], value: ends[i].value, parts: ends[i].parts, won: battle ? ends[i].parts?.lost === 0 : !!ends[i].won }))
          })
        }
      }
    }
    const action = policy(run, rng, 'expert')
    apply(run, action)
    if (run.state.phase !== 'battle' && (action.type === 'fight' || was === 'battle')) {
      const x = closeOf(run)
      fought++
      if (x.won) won++
      else fell = x.fell
    }
  }
  const s = run.state
  for (const k of Object.values(counts)) k.ms = Math.round(k.ms)
  return {
    line: {
      seed, player: 'label', result: s.result ?? null, floor: s.floor, progress: progressOf({ result: s.result, floor: s.floor, rank: fell?.rank ?? 1, share: fell?.share ?? 0 }),
      battles: { won, fought }, ms: Math.round(performance.now() - t0), phases: counts, rows: rows.length, fights: m.stats.fights, settings: labelSettings(lc), base: baseOf()
    },
    rows
  }
}
// The settings a labelling's lines and manifest record (the recruit's and the purchases' alone as they were first
// recorded).
const labelSettings = (lc) => ({ label: true, cap: lc.cap, spend: lc.spend, calm: lc.calm, ...(lc.phases.join() !== LABEL.phases && { phases: lc.phases.join(), formations: lc.formations, floors: lc.floors }) })

// `npm run outside -- --label [--runs 200] [--seed outl] [--from 0] [--workers 8] [--out dir] [--cap 6] [--formations 9]
// [--spend 1] [--calm 0.25] [--phases recruit,spend,prep] [--floors 1,1,1,1]`: labels seeds `<seed>-<from>`… (labelRun), each a
// worker's whole run, into `--out` (the OS's temp directory, retinue-outlabel-<seed>, by default): labels.jsonl (a row a
// decision), runs.jsonl (a line a run, written after its rows), manifest.json (the settings, the base, the counts, the
// wall time and the throughput: decisions, candidates and runs an hour). A stage stopped part way goes on from where it
// was: the rows of a run with no line are dropped, the runs with one skipped. The settings must be the same.
async function labelMain (arg) {
  const seed = arg('seed', 'outl')
  const runs = Number(arg('runs', 200))
  const from = Number(arg('from', 0))
  const workers = Number(arg('workers', 8))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-outlabel-${seed}`))
  const lc = labelConfig({
    cap: Number(arg('cap', LABEL.cap)), formations: Number(arg('formations', LABEL.formations)), spend: Number(arg('spend', LABEL.spend)), calm: Number(arg('calm', LABEL.calm)),
    phases: arg('phases', LABEL.phases), floors: arg('floors', LABEL.floors.join())
  })
  const settings = labelSettings(lc)
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  fs.mkdirSync(dir, { recursive: true })
  const runsFile = path.join(dir, 'runs.jsonl')
  const labelsFile = path.join(dir, 'labels.jsonl')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was labelled with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const done = new Set(read(runsFile).map((r) => r.seed))
  // Rows of a run stopped before its line was written are dropped.
  if (fs.existsSync(labelsFile)) {
    const keep = fs.readFileSync(labelsFile, 'utf8').split('\n').filter((l) => l && done.has(JSON.parse(l).seed))
    fs.writeFileSync(labelsFile, keep.length ? keep.join('\n') + '\n' : '')
  }
  const manifest = (extra = {}) => ({ made: new Date().toISOString(), settings, base: baseOf(), ...extra })
  if (!had) fs.writeFileSync(manifestFile, JSON.stringify(manifest(), null, 1) + '\n')
  const seeds = Array.from({ length: runs }, (_, k) => `${seed}-${from + k}`)
  const jobs = seeds.filter((s) => !done.has(s)).map((s) => ({ seed: s, player: 'label' }))
  const t0 = performance.now()
  if (jobs.length) {
    console.log(`labelling ${jobs.length} runs (seeds ${seeds[0]}…${seeds.at(-1)}; ${done.size} done in ${dir}) on ${workers} workers: ${JSON.stringify(settings)}`)
    let n = 0
    await pool(jobs, workers, lc, ({ line, rows }) => {
      if (rows.length) fs.appendFileSync(labelsFile, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
      fs.appendFileSync(runsFile, JSON.stringify(line) + '\n')
      const p = line.phases
      const by = lc.phases.map((ph) => `${ph} ${p[ph].labelled} of ${p[ph].met} (${p[ph].candidates} candidates, ${p[ph].beaten} beaten)`).join(', ')
      console.log(`  ${++n}/${jobs.length} ${line.seed}: ${line.result ?? 'lost'} on floor ${line.floor}, ${(line.ms / 1000).toFixed(0)} s; ${by}; ${line.fights} fights played (${((performance.now() - t0) / 1000).toFixed(0)} s in)`)
    })
  }
  const lines = read(runsFile).filter((r) => seeds.includes(r.seed))
  const sum = (ph, k) => lines.reduce((n, r) => n + r.phases[ph][k], 0)
  const wall = +((had?.wall ?? 0) + (jobs.length ? (performance.now() - t0) / 1000 : 0)).toFixed(1)
  const phases = Object.fromEntries(lc.phases.map((ph) => [ph, Object.fromEntries(['met', 'undrawn', 'again', 'labelled', 'candidates', 'playouts', 'hits', 'ms', 'beaten'].map((k) => [k, sum(ph, k)]))]))
  const hours = wall / 3600 || 1
  const all = (k) => lc.phases.reduce((n, ph) => n + phases[ph][k], 0)
  const throughput = { runsPerHour: +(lines.length / hours).toFixed(1), decisionsPerHour: Math.round(all('labelled') / hours), candidatesPerHour: Math.round(all('candidates') / hours), msPerRun: Math.round(lines.reduce((n, r) => n + r.ms, 0) / Math.max(1, lines.length)) }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest({ runs: lines.length, clears: lines.filter((r) => r.result === 'victory').length, rows: lines.reduce((n, r) => n + r.rows, 0), phases, wall, workers, throughput }), null, 1) + '\n')
  console.log(`${lines.length} runs labelled (${lines.filter((r) => r.result === 'victory').length} cleared), ${wall.toFixed(0)} s on ${workers} workers: ${JSON.stringify(phases)}; ${JSON.stringify(throughput)}`)
}

// The rows of `seed` (labelRun's, labelled at a cap of `cap`, `formations` a prep's) read again as autoplay.js
// outsideRead and prepRead read them now: the base's run walked again (it is the labelled run, move for move), and at
// each row's decision (its log index) its candidates listed again (the same, or it throws) and read; the values kept.
// Seconds a run, no playout. → rows
export function rereadRun (seed, rows, cap = LABEL.cap, formations = LABEL.formations) {
  const run = ablatedRun(seed)
  const rng = createRng(run.state.seed).stream('autoplay')
  const at = new Map(rows.map((r) => [`${r.at}|${r.phase === 'prep'}`, r]))
  const out = []
  for (let guard = 0; run.state.phase !== 'over' && out.length < rows.length; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    if (run.state.phase !== 'battle') {
      for (const row of [at.get(`${run.state.log.length}|false`), at.get(`${run.state.log.length}|true`)]) {
        if (!row) continue
        const sit = survey(run, L)
        const cands = row.phase === 'prep'
          ? prepCandidates(run, L, plan(run, L), { cap: formations }).cands
          : outCandidates(row.phase === 'recruit' ? recruitCandidates(run, L, sit) : spendCandidates(run, L, sit), cap)
        if (cands.map((x) => x.id).join() !== row.options.map((o) => o.id).join()) throw new Error(`${seed}: the candidates at ${row.at} are no longer the labels'`)
        const read = row.phase === 'prep' ? prepRead(run, L, sit, cands) : outsideRead(run, L, sit, row.phase, cands)
        out.push({ ...row, sit: read.sit, options: row.options.map((o, i) => ({ ...o, f: read.f[i] })) })
      }
    }
    apply(run, policy(run, rng, 'expert'))
  }
  if (out.length !== rows.length) throw new Error(`${seed}: ${rows.length - out.length} rows not met again`)
  return out
}

// `npm run outside -- --reread <dir> --out <dir> [--workers 8]`: a label set read again (rereadRun), its rows written to
// `--out` with its runs' lines and its manifest (`reread` the time it was read again).
async function rereadMain (arg) {
  const from = arg('reread')
  const dir = arg('out', null)
  if (!dir || path.resolve(dir) === path.resolve(from)) throw new Error('--reread <dir> --out <another dir>')
  const workers = Number(arg('workers', 8))
  const manifest = JSON.parse(fs.readFileSync(path.join(from, 'manifest.json'), 'utf8'))
  const lines = fs.readFileSync(path.join(from, 'runs.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  const done = new Set(lines.map((r) => r.seed))
  const bySeed = new Map()
  for (const l of fs.readFileSync(path.join(from, 'labels.jsonl'), 'utf8').split('\n')) {
    if (!l) continue
    const row = JSON.parse(l)
    if (!done.has(row.seed)) continue
    if (!bySeed.has(row.seed)) bySeed.set(row.seed, [])
    bySeed.get(row.seed).push(row)
  }
  fs.mkdirSync(dir, { recursive: true })
  const out = path.join(dir, 'labels.jsonl')
  fs.writeFileSync(out, '')
  const t0 = performance.now()
  let n = 0
  await pool([...bySeed.keys()].map((seed) => ({ seed, player: 'reread', rows: bySeed.get(seed) })), workers, { cap: manifest.settings.cap, formations: manifest.settings.formations ?? LABEL.formations }, (rows) => {
    fs.appendFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    n++
  })
  fs.writeFileSync(path.join(dir, 'runs.jsonl'), lines.map((r) => JSON.stringify(r)).join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...manifest, reread: new Date().toISOString(), from }, null, 1) + '\n')
  console.log(`${n} runs read again from ${from} into ${dir} (${((performance.now() - t0) / 1000).toFixed(0)} s)`)
}

// The outside teacher against the expert as it ships, paired by seed over runs.jsonl's lines (teach.js pairedReport: the
// clears, the seeds won and lost against the base, the progress difference ± one standard error, the battles won, the
// deaths by floor, the time a run), and by phase: the decisions it made a run, how often it took another than the base's
// pick, the candidates played a decision, the playouts and the share of them that ended at a fight already played, the
// decisions settled by a clear and the overrides whose line cleared the run (`found`, where the lines record their
// overrides), the time a decision, the value gained over the base's pick a decision. → { …pairedReport, phases,
// fightsPerRun }
export function outsideReport (lines) {
  const rep = pairedReport(lines.map((r) => (r.player === 'outside' ? { ...r, player: 'teacher' } : r)))
  const seeds = new Set(lines.filter((r) => r.player === 'expert').map((r) => r.seed))
  const T = lines.filter((r) => r.player === 'outside' && seeds.has(r.seed))
  const phases = {}
  for (const p of PHASES) {
    const sum = (k) => T.reduce((n, r) => n + (r.phases?.[p]?.[k] ?? 0), 0)
    const d = sum('decided')
    phases[p] = {
      asked: sum('asked'), decided: d, perRun: +(d / Math.max(1, T.length)).toFixed(2), overrides: sum('overrides'), overrideRate: d ? +(sum('overrides') / d).toFixed(4) : null,
      candidates: d ? +(sum('candidates') / d).toFixed(2) : null, playouts: sum('playouts'), hitRate: sum('playouts') ? +(sum('hits') / sum('playouts')).toFixed(4) : null,
      settled: sum('settled'), found: T.some((r) => r.picks) ? T.reduce((n, r) => n + (r.picks ?? []).filter((x) => x.phase === p && x.cleared).length, 0) : null, msPerDecision: d ? Math.round(sum('ms') / d) : null, gainPerDecision: d ? +(sum('gain') / d).toFixed(4) : null
    }
  }
  return { ...rep, phases, fightsPerRun: Math.round(T.reduce((n, r) => n + (r.fights ?? 0), 0) / Math.max(1, T.length)) }
}

// outsideReport's in lines, for the console.
export function outsideLines (rep) {
  const pc = (x) => (x === null ? '-' : `${(100 * x).toFixed(1)}%`)
  const deaths = (x) => Object.entries(x).map(([k, v]) => `floor ${k} ${v}`).join(', ') || 'none'
  const { teacher: t, expert: e } = rep
  return [
    `the outside teacher against the expert as it ships, ${rep.n} seeds paired:`,
    `  clears          outside ${t.clears}/${rep.n} (${pc(t.rate)}), shipped ${e.clears}/${rep.n} (${pc(e.rate)}); the outside teacher cleared ${rep.clears.gained} the shipped lost, lost ${rep.clears.lost} the shipped cleared`,
    `  progress        outside ${t.progress.toFixed(4)}, shipped ${e.progress.toFixed(4)}; difference ${rep.progress.diff >= 0 ? '+' : ''}${rep.progress.diff.toFixed(4)} ± ${rep.progress.se.toFixed(4)} (one standard error, paired)`,
    `  battles won     outside ${t.battles.won}/${t.battles.fought} (${pc(t.battles.rate)}), shipped ${e.battles.won}/${e.battles.fought} (${pc(e.battles.rate)})`,
    `  deaths by floor outside ${deaths(t.deaths)}; shipped ${deaths(e.deaths)}`,
    `  time a run      outside ${(t.msPerRun / 1000).toFixed(1)} s (${rep.cost.decisionsPerRun} decisions, ${rep.cost.playoutsPerDecision} playouts and ${rep.cost.msPerDecision} ms a decision; ${rep.fightsPerRun} fights played in playouts a run), shipped ${(e.msPerRun / 1000).toFixed(1)} s`,
    '  by phase        decided a run  overrode         played a decision  playouts (ended at a fight played)  settled by a clear  found a clear  ms a decision  value gained a decision',
    ...PHASES.map((p) => {
      const x = rep.phases[p]
      return `    ${p.padEnd(13)} ${String(x.perRun).padStart(8)}  ${String(x.overrides).padStart(5)}/${String(x.decided).padEnd(6)} (${pc(x.overrideRate)})  ${String(x.candidates ?? '-').padStart(8)}  ${String(x.playouts).padStart(14)} (${pc(x.hitRate)})  ${String(x.settled).padStart(12)}  ${String(x.found ?? '-').padStart(13)}  ${String(x.msPerDecision ?? '-').padStart(14)}  ${x.gainPerDecision ?? '-'}`
    })
  ]
}

// ── run directly ─────────────────────────────────────────────────────────────────────────────────

// A worker's job: a run by the outside teacher, by the expert as it ships, labelled, or a labelled run's rows read
// again ({ seed, player, rows? }).
const job = (j, cfg) => (j.player === 'label' ? labelRun(j.seed, cfg) : j.player === 'reread' ? rereadRun(j.seed, j.rows, cfg.cap, cfg.formations) : j.player === 'outside' ? outsideRun(j.seed, cfg) : expertRun(j.seed))

// Runs `jobs` in worker threads of this module, `workers` at a time, handing each result to `done` as it ends.
async function pool (jobs, workers, cfg, done) {
  const { Worker } = await import('node:worker_threads')
  const queue = jobs.slice()
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { outside: true, cfg } })
    try {
      while (queue.length) {
        const j = queue.shift()
        done(await new Promise((resolve, reject) => {
          const off = () => {
            w.off('message', ok)
            w.off('error', fail)
          }
          const ok = (msg) => {
            off()
            resolve(msg)
          }
          const fail = (err) => {
            off()
            reject(err)
          }
          w.on('message', ok)
          w.on('error', fail)
          w.postMessage(j)
        }))
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, worker))
}

// `npm run outside -- …` (see the head of this file).
async function main () {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  if (process.argv.includes('--label')) return labelMain(arg)
  if (arg('reread', null)) return rereadMain(arg)
  const seed = arg('seed', 'sim')
  const runs = Number(arg('runs', 64))
  const from = Number(arg('from', 0))
  const workers = Number(arg('workers', 2))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-outside-${seed}`))
  const c = configOf({ phases: arg('phases', PHASES.join(',')), cap: Number(arg('cap', DEFAULTS.cap)), rooms: Number(arg('rooms', DEFAULTS.rooms)), prep: arg('prep', DEFAULTS.prep), won: process.argv.includes('--won') })
  const settings = settingsOf(c)
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  fs.mkdirSync(dir, { recursive: true })
  const runsFile = path.join(dir, 'runs.jsonl')
  const manifestFile = path.join(dir, 'manifest.json')
  const had = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : null
  if (had && JSON.stringify(had.settings) !== JSON.stringify(settings)) throw new Error(`${dir} was played with other settings (${JSON.stringify(had.settings)}): take another --out`)
  const manifest = (extra = {}) => ({ made: new Date().toISOString(), settings, base: baseOf(), ...extra })
  if (!had) fs.writeFileSync(manifestFile, JSON.stringify(manifest(), null, 1) + '\n')
  const seeds = Array.from({ length: runs }, (_, k) => `${seed}-${from + k}`)
  const key = (r) => `${r.player}|${r.seed}`
  const done = new Set(read(runsFile).map(key))
  // A seed's two runs side by side in the queue (the teacher's first, the longer), so the pairs fill in order.
  const jobs = seeds.flatMap((s) => ['outside', 'expert'].map((player) => ({ seed: s, player }))).filter((j) => !done.has(key(j)))
  const t0 = performance.now()
  if (jobs.length && !process.argv.includes('--report-only')) {
    console.log(`playing ${jobs.length} runs (seeds ${seeds[0]}…${seeds.at(-1)}, the outside teacher's and the shipped expert's; ${done.size} done in ${dir}) on ${workers} workers: ${JSON.stringify(settings)}`)
    let n = 0
    await pool(jobs, workers, { ...settings, phases: settings.phases.join(',') }, (r) => {
      fs.appendFileSync(runsFile, JSON.stringify(r) + '\n')
      const s = ((performance.now() - t0) / 1000).toFixed(0)
      const cost = r.player === 'outside' ? `; ${r.decisions} decisions (${PHASES.map((p) => `${p} ${r.phases[p].decided}/${r.phases[p].overrides}`).join(', ')}), ${r.playouts} playouts, ${r.fights} fights played` : ''
      console.log(`  ${++n}/${jobs.length} ${r.player.padEnd(7)} ${r.seed}: ${r.result ?? 'lost'} on floor ${r.floor}, progress ${r.progress.toFixed(3)}, battles ${r.battles.won}/${r.battles.fought}, ${(r.ms / 1000).toFixed(1)} s${cost} (${s} s in)`)
    })
  }
  const wall = (performance.now() - t0) / 1000
  const want = new Set(seeds)
  const lines = read(runsFile).filter((r) => want.has(r.seed))
  const rep = { seeds: `${seeds[0]}…${seeds.at(-1)}`, ...outsideReport(lines) }
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1) + '\n')
  fs.writeFileSync(manifestFile, JSON.stringify(manifest({
    counts: { outside: lines.filter((r) => r.player === 'outside').length, expert: lines.filter((r) => r.player === 'expert').length },
    wall: +((had?.wall ?? 0) + (jobs.length ? wall : 0)).toFixed(1), workers
  }), null, 1) + '\n')
  console.log(outsideLines(rep).join('\n'))
}

if (!isMainThread && workerData?.outside) {
  parentPort.on('message', (j) => parentPort.postMessage(job(j, workerData.cfg)))
} else if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
