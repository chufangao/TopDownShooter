// The outside teacher, offline and never shipped: each of the expert's choices between battles made by playing its
// candidates out on a copy of the run by the base (the expert in use, which also plays every battle), the best taken;
// and the labels for the forest out of battle (outforest.js).
//
//   npm run outside -- [flags]                 seeds played by the outside teacher and by the expert as it ships, paired
//     --runs 64 --seed sim --from 0   seeds <seed>-<from>…<seed>-<from + runs − 1>
//     --workers 2               worker threads
//     --out dir                 the stage's directory (retinue-outside-<seed> in the OS temp dir); one stopped part way goes on
//     --phases prep,spend,recruit,shop,hold,altar   the decisions it makes; the rest are the base's
//     --cap 6                   a decision's candidates at most, the base's pick among them
//     --rooms 0                 0: each playout to the run's end; n: until n rooms are done
//     --prep battle|run         a formation valued by its coming battle, or to the run's end
//     --won                     to the end: the first candidate whose playout clears the run taken, the rest unplayed
//     --ascension 0 --monarch id   the runs' ascension level and Monarch (the base one by default)
//     --report-only             the report alone, from what --out holds
//   npm run outside -- --label [flags]         label the base's decisions for the forest out of battle
//     --runs 200 --seed outl --from 0 --workers 8 --out dir   as above (retinue-outlabel-<seed>)
//     --phases recruit,spend    the decisions labelled, of recruit, spend and prep
//     --cap 6 --formations 9    a recruit's or a purchase's candidates at most, and a prep's
//     --spend 1 --calm 0.25     a purchase's chance of a label with two kinds (or a fusion) among its candidates, and without
//     --floors 1,…              a label's chance by floor, the last for every floor past them, 0 for none there; a
//                               purchase's is it × --spend or --calm, a recruit's it × --recruits
//     --recruits 1,…            a recruit's chance of a label by floor, × --floors
//   npm run outside -- --reread <dir> --out <dir> [--workers 8]   a label set's reads made again, its values kept
//
// A playout's value: to the run's end teach.js routeEndValue's from the decision (ROUTE_END_WEIGHTS), over a window
// routeValue's (ROUTE_WEIGHTS), a formation's by its coming battle endValue's (END_WEIGHTS).
// runs.jsonl, a line a run: { seed, player ('outside' or 'expert'), result, floor, progress, battles: { won, fought },
//   ms, and the teacher's decisions, playouts, single, decisionMs, phases (outsideStats'), fights, picks, settings, base }
// --label labels.jsonl, a row a decision: { seed, run, split, phase, floor, rank, at (the run's log index), wt (1 / its
//   chance), sit, options: [{ action, id, today, base, f, value, parts, won }] }; runs.jsonl a line a run (labelRun's).
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  apply, availableNodes, currentNode, canPlace, canHold, canBuy, relicPrice, unheld, souls, fielded, isMonarch, soulCount, rosterCap, OSSUARY,
  ascensionTop, BASE_MONARCH, copyRun
} from './run.js'
import { createRng, hashString } from './rng.js'
import {
  LEVELS, policy, survey, planFor, plan, pickRoute, pickHold, pickReap, buyFor, growthOf, sketch, held, tierRate, offerState,
  progressOf, routeRooms, ablatedRun, routeModel, ROUTE_LEARNED, spendCandidates, recruitCandidates, rankCandidates, outCandidates, spendPick, recruitPick, outsideRead,
  prepCandidates, prepRead, formationName, PREP_CAP, pickDraft, pickAltar, altarCandidates, asMonarch, monarchArg
} from './autoplay.js'
import { outForestModel, outDecides } from './outforest.js'
import { value, expertModel } from './expert.js'
import { forestModel, r6 } from './forest.js'
import { pool as workerPool } from './pool.js'
import { splitOf } from './forestfit.js'
import { arg, has, isMain } from './cli.js'
import {
  routeEndValue, routeEndOf, routeValue, ROUTE_END_WEIGHTS, ROUTE_WEIGHTS, endTally, endValue, END_WEIGHTS, expertRun, pairedReport, pairedLines, pc, closeOf
} from './teach.js'
import { TUNING } from '../tuning.js'

export const PHASES = Object.freeze(['prep', 'spend', 'recruit', 'shop', 'hold', 'altar'])
export const PREPS = Object.freeze(['battle', 'run'])
export const DEFAULTS = Object.freeze({ phases: PHASES, cap: 6, rooms: 0, prep: 'battle', won: false, ascension: 0, monarch: BASE_MONARCH })
const L = LEVELS.expert
const EPS = 1e-9

// A configuration made whole: its phases a Set of known names, its cap a whole number, 1 or more.
export function configOf (cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const phases = typeof c.phases === 'string' ? c.phases.split(',').filter(Boolean) : [...c.phases]
  for (const p of phases) if (!PHASES.includes(p)) throw new Error(`unknown phase "${p}": ${PHASES.join(', ')}`)
  if (!(Number.isInteger(c.cap) && c.cap >= 1)) throw new Error(`cap ${c.cap}: a whole number, 1 or more`)
  if (!(Number.isInteger(c.rooms) && c.rooms >= 0)) throw new Error(`rooms ${c.rooms}: a whole number, 0 for the run's end`)
  if (!PREPS.includes(c.prep)) throw new Error(`prep ${c.prep}: one of ${PREPS.join(', ')}`)
  if (!(Number.isInteger(c.ascension) && c.ascension >= 0 && c.ascension <= ascensionTop())) throw new Error(`ascension ${c.ascension}: a level from 0 to ${ascensionTop()}`)
  return { ...c, won: !!c.won && !(c.rooms > 0), phases: new Set(phases), monarch: monarchArg(c.monarch) }
}

// ── the base's dispatch out of battle (mirrors autoplay.js policy) ─────────────────────────────────

const copyOf = copyRun
// The base's plan's key (autoplay.js planFor's): what a formation depends on; one chosen for a key holds while it does.
const planKey = (run) => {
  const s = run.state
  return JSON.stringify([L, s.floor, s.at, s.camp, s.relics, s.nextUid, s.party.map((u) => [u.uid, u.id, u.lvl, u.hp, u.maxHp, u.tracks, u.relics])])
}

// One step toward formation `goal` as the base steps toward its plan: a soul it leaves out to the ossuary, else one
// straight into its cell, else one not in place to the ossuary to clear the way, else fight.
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

// The base's action out of battle (autoplay.js policy), decision `skip` passed on ('hold', 'shop' or 'spend', each also
// passing those before it) and in prep formation `goal` walked to in place of the base's plan.
export function baseStep (run, sit = survey(run, L), { skip = null, goal = null } = {}) {
  const s = run.state
  if (s.phase === 'draft') return pickDraft(run, L)
  if (s.phase === 'reap') return pickReap(run, L, sit)
  if (s.phase === 'altar') return pickAltar(run, L, sit)
  const hold = skip ? null : pickHold(run, L, sit)
  if (hold) return hold
  if (s.phase !== 'map' && s.phase !== 'prep') throw new Error(`no step out of battle for phase "${s.phase}"`)
  const buy = s.phase === 'map' && skip !== 'shop' && skip !== 'spend' ? buyFor(run, L, sit) : null
  if (buy) return buy
  const spend = skip === 'spend' ? null : spendPick(run, L, sit)
  if (spend) return spend
  if (s.phase === 'map') {
    const nodes = availableNodes(run)
    return { type: 'node', id: nodes.length > 1 ? pickRoute(run, sit) : nodes[0].id }
  }
  return prepStep(run, goal ?? planFor(run, L))
}

// ── values ───────────────────────────────────────────────────────────────────────────────────────

// Where a decision stands for routeEndValue's `before`: its floor, and the share of the route done.
const ZERO = Object.freeze({ share: 0, floor: 0 })
export function beforeOf (run) {
  const s = run.state
  const rank = currentNode(run)?.rank ?? 0
  return { floor: s.floor, share: progressOf({ result: null, floor: s.floor, rank: s.phase === 'map' ? rank + 1 : rank }) }
}
// A playout's end (routeEndValue from floor 0, no room done) read from `before`: its parts from there, and its value.
const partsFrom = (end, before) => ({ ...end.parts, rooms: end.parts.rooms - before.share * routeRooms(), floors: end.parts.floors - before.floor })
const fromEnd = (end, before, w) => r6(routeEndOf(partsFrom(end, before), w))

// What a window's value reads of a run (teach.js runTally, mirrored).
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
const roomDone = (was, now, action, run) => (now === 'over' ? !run.state.death : now === 'map' && (was !== 'map' || action.type === 'node'))

// A run's board at a fight it opens: its state but its log, hashed (the base's play from there is a pure function of it).
const keyOf = (run) => {
  const { log, ...rest } = run.state
  return hashString(JSON.stringify(rest))
}

// The base's plan for the prep `run` stands in, kept by planKey across the playouts' copies (planFor keeps one a run object).
function planOf (run, m, key = planKey(run)) {
  if (!m.plans.has(key)) m.plans.set(key, planFor(run, L))
  return m.plans.get(key)
}

// One candidate played out on a copy of `run`: its `actions` (illegal: −Infinity), then the base to the run's end, for
// `rooms` rooms or (`battle`) to the coming battle's end; each fight it opens looked up and kept in `m.ends` or `m.battles`.
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
// One decision: each candidate (the base's first) played out, the best value taken, a tie to the base's; with `won` the
// first that clears the run, and a formation by its battle the base's where its line clears (`settled`).
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

// The growth search's score of hold `a` (null: keeping the relic), as autoplay.js grow weighs it.
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
// Passing on: the base's next decision's action taken now, in prep walking to the formation chosen.
const passOn = (run, m, sit, skip) => ({
  id: idOf(null), label: skip === 'hold' ? 'keep' : 'stop', take: null, actions: [baseStep(run, sit, { skip, goal: run.state.phase === 'prep' ? goalOf(run, m) ?? planOf(run, m) : null })]
})

// Each decision's list, read where the base would make it: { act } where there is no decision (null: pass on), else
// { phase, cands (the base's pick first), opts (playout's), then (the action the chosen takes now, null to pass on) }.

// Each piece relic waiting given to each standing soul that may hold it, or kept; a fallen soul's unhold is no decision.
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

// Each tier and fusion the purse affords (autoplay.js spendCandidates), or stopping.
function spendList (run, m, c, sit) {
  const d = spendCandidates(run, L, sit)
  if (!d) return { act: null }
  const base = spendPick(run, L, sit)
  if (!c.phases.has('spend')) return { act: base }
  const stop = passOn(run, m, sit, 'spend')
  const cands = d.cands.map((x) => (x.actions.length ? { ...x, take: x.actions[0] } : { ...x, ...stop }))
  return { phase: 'spend', cands: rankCandidates(cands, idOf(base), c.cap), then: (x) => x.take }
}

// Each relic on the Shop's shelf the purse affords, or none (passing on: the base's purchases, then its room).
function shopList (run, m, c, sit) {
  const s = run.state
  const base = buyFor(run, L, sit)
  if (!c.phases.has('shop')) return { act: base }
  const sk = sketch(s, L)
  const cands = []
  for (const [index, id] of s.shop.entries()) {
    if (!id || !canBuy(run, index)) continue
    const a = { type: 'buy', index }
    cands.push({ id: idOf(a), label: `buy ${id}`, take: a, actions: [a], score: (held({ ...s, ...offerState(s, { type: 'relic', id }) }, id, L) - sk) / relicPrice(run, id) })
  }
  if (!cands.length) return { act: base }
  const none = { ...passOn(run, m, sit, 'shop'), score: tierRate(run, L, sk) }
  return { phase: 'shop', cands: rankCandidates([none, ...cands], idOf(base), c.cap), then: (x) => x.take }
}

// The one recruit a battle allows (autoplay.js recruitCandidates), or none. A recruit after a release is two actions:
// the release now, the recruit at the next call (`m.recruit`).
function recruitList (run, m, c, sit) {
  const s = run.state
  const key = JSON.stringify([s.floor, s.at, s.offers.map((o) => o.id)])
  if (m.recruit?.key === key && m.recruit.next.length) return { act: m.recruit.next.shift() }
  const base = pickReap(run, L, sit)
  if (!c.phases.has('recruit')) return { act: base }
  const d = recruitCandidates(run, L, sit)
  // The base's pick: today's, or the forest's where it decides recruits, its release kept only for a full retinue.
  const full = soulCount(s.party) >= rosterCap(run)
  const own = outDecides('recruit') ? idOf(recruitPick(run, L, sit).filter((a) => full || a.type !== 'release')) : d.today
  const cands = d.cands.map((x) => ({ ...x, take: x.actions[0] }))
  const then = (x) => {
    if (x.actions.length > 1) m.recruit = { key, next: x.actions.slice(1) }
    return x.actions[0]
  }
  return { phase: 'recruit', cands: rankCandidates(cands, own, c.cap), then }
}

// The formations a prep may field, at most `cap` (autoplay.js prepCandidates), the base's own (`own`) first.
// → [{ id, label, goal: [{ uid, slot }], actions: [] }]
function formationGoals (run, cap, own = planFor(run, L)) {
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

// An altar's rite (autoplay.js altarCandidates), one taken: no passing on.
function altarList (run, m, c, sit) {
  const base = pickAltar(run, L, sit)
  if (!c.phases.has('altar')) return { act: base }
  const d = altarCandidates(run, L, sit)
  const cands = d.cands.map((x) => ({ ...x, take: x.actions[0] }))
  return { phase: 'altar', cands: rankCandidates(cands, idOf(base), c.cap), then: (x) => x.take }
}

// On the map, once the relics and the purse are seen to: the base's room.
const roomList = (run, m, c, sit) => ({ act: baseStep(run, sit, { skip: 'spend' }) })

// The draft's picks are the base's (autoplay.js pickDraft): no decision the teacher plays out.
const draftList = (run) => ({ act: pickDraft(run, L) })

// The decisions each phase meets, in the order the base meets them.
const ORDER = { draft: [draftList], map: [holdList, shopList, spendList, roomList], prep: [holdList, spendList, formationList], reap: [recruitList], altar: [altarList] }

// The decisions at `run` in order, each made (`play`) or passed on, until one gives an action. → { act }; without
// `play`, the first decision met unmade: { phase, cands }.
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

// What the teacher keeps a run: the fights its playouts opened, each with where it led (`ends` to the run's end, `battles`
// to the battle's), the base's plans by key, the prep's chosen formation (`goal`), a recruit after a release, its counts.
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
// The teacher's counts for `run`, by phase { asked, decided, overrides, candidates, playouts, hits (ended at a fight
// played), settled, ms, gain (over the base's pick) }; `picks` (its overrides), fights, ms; and its last decision.
export function outsideStats (run) {
  const m = memoOf(run)
  return { ...m.stats, last: m.last }
}

// The outside teacher's action for `run` in place of autoplay.js policy out of battle; its memory lives as long as the run.
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

// The first decision the outside teacher meets at `run`, its candidates listed (the base's first), none played out.
// → { phase, cands: [{ label, actions, take, goal }] } or { act }
export function candidatesAt (run, cfg = {}) {
  return decideAt(run, memoOf(run), configOf(cfg), survey(run, L), false)
}

// ── runs ─────────────────────────────────────────────────────────────────────────────────────────

// What played as the base: the expert's model, the forest, the route and the forest out of battle in use.
const baseOf = () => ({ expert: expertModel()?.name ?? null, forest: forestModel()?.name ?? null, route: routeModel() ? routeModel().name ?? 'learned' : 'hand', learned: ROUTE_LEARNED, outforest: outForestModel()?.name ?? null })

// One run, the outside teacher out of battle and the base in it (`battles`: stop early; `log`). → its runs.jsonl line
export function outsideRun (seed, cfg = {}) {
  const c = configOf(cfg)
  const t0 = performance.now()
  const run = ablatedRun(seed, null, null, { ascension: c.ascension, monarch: c.monarch })
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

const settingsOf = (c) => ({
  phases: PHASES.filter((p) => c.phases.has(p)), cap: c.cap, rooms: c.rooms, prep: c.prep, ...(c.won && { won: true }), ...(c.ascension && { ascension: c.ascension }), ...asMonarch(c.monarch)
})

// ── labels for the forest out of battle ──────────────────────────────────────────────────────────

// --label: runs of the base, each candidate of a decision drawn played out on a copy by the base, a recruit's and a
// purchase's to the run's end, a formation's to its battle's end. The candidates are those the forest out of battle reads
// in play (outCandidates, prepCandidates), read as play reads them (outsideRead, prepRead). A purchase met again unchanged
// but for its placements is labelled once; a prep once a plan, where the base would first place a soul or fight.
export const LABEL = Object.freeze({ cap: 6, formations: PREP_CAP, spend: 1, calm: 0.25, phases: 'recruit,spend', floors: Object.freeze([1]), recruits: Object.freeze([1]) })
const LABEL_PHASES = Object.freeze(['recruit', 'spend', 'prep'])
const labelDraw = (seed, at, phase) => parseInt(hashString(phase === 'prep' ? `outside-label|prep|${seed}|${at}` : `outside-label|${seed}|${at}`).slice(0, 8), 16) / 2 ** 32

// A labelling's settings made whole: its phases known, its floors' and its recruits' chances each in [0, 1].
export function labelConfig (cfg = {}) {
  const lc = { ...LABEL, ...cfg }
  const phases = typeof lc.phases === 'string' ? lc.phases.split(',').filter(Boolean) : [...lc.phases]
  for (const p of phases) if (!LABEL_PHASES.includes(p)) throw new Error(`no labels for phase "${p}": ${LABEL_PHASES.join(', ')}`)
  const list = (x) => (typeof x === 'string' ? x.split(',').map(Number) : [...x])
  const floors = list(lc.floors)
  if (!floors.length || !floors.every((x) => x >= 0 && x <= 1)) throw new Error(`floors ${floors}: each floor's chance in [0, 1]`)
  const recruits = list(lc.recruits)
  if (!recruits.length || !recruits.every((x) => x >= 0 && x <= 1)) throw new Error(`recruits ${recruits}: each floor's chance in [0, 1]`)
  return { ...lc, phases, floors, recruits }
}
const floorChance = (floor, lc, of = lc.floors) => of[Math.min(floor, of.length) - 1]

// The recruit or purchase the base meets first at `run`: { phase, cands (outCandidates'), plays, base (the base's pick's
// id) }, or null where it has fewer than two candidates or is the recruit a release made way for.
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

// The prep the base meets at `run`, once a plan, where its next step is the formation's: { phase 'prep', cands, plays,
// base (planFor's formation's id) }, or null.
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

// A purchase decision's chance of a label: `spend` with two kinds, or a fusion and another, among its candidates, else `calm`.
function spendChance (cands, lc) {
  const kinds = new Set(cands.flatMap((x) => x.actions.map((a) => (a.type === 'fuse' ? `fuse ${a.id}` : a.kind))))
  return kinds.size >= 2 ? lc.spend : lc.calm
}

// One run of the base on `seed`, labelled. → { line (runs.jsonl's), rows (labels.jsonl's) }
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
        const chance = floorChance(s.floor, lc) * (d.phase === 'spend' ? spendChance(d.cands, lc) : d.phase === 'prep' ? 1 : floorChance(s.floor, lc, lc.recruits))
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
// The settings a labelling's lines and manifest record, the defaults left out.
const labelSettings = (lc) => ({
  label: true, cap: lc.cap, spend: lc.spend, calm: lc.calm, ...(lc.phases.join() !== LABEL.phases && { phases: lc.phases.join(), formations: lc.formations, floors: lc.floors }),
  ...(lc.recruits.join() !== LABEL.recruits.join() && { recruits: lc.recruits })
})

// --label: labelRun on worker threads into `--out` (labels.jsonl, runs.jsonl, manifest.json), going on where it stopped.
async function labelMain (arg) {
  const seed = arg('seed', 'outl')
  const runs = Number(arg('runs', 200))
  const from = Number(arg('from', 0))
  const workers = Number(arg('workers', 8))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-outlabel-${seed}`))
  const lc = labelConfig({
    cap: Number(arg('cap', LABEL.cap)), formations: Number(arg('formations', LABEL.formations)), spend: Number(arg('spend', LABEL.spend)), calm: Number(arg('calm', LABEL.calm)),
    phases: arg('phases', LABEL.phases), floors: arg('floors', LABEL.floors.join()), recruits: arg('recruits', LABEL.recruits.join())
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

// The rows of `seed` read again as autoplay.js outsideRead and prepRead read them now, the base's run walked again;
// the candidates must be the same (else it throws), the values kept. → rows
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

// --reread: a label set read again (rereadRun), written to `--out` with its runs' lines and its manifest (`reread`).
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

// The outside teacher against the expert as it ships (teach.js pairedReport), and by phase: decisions a run, overrides,
// candidates, playouts and hits, settled, `found` (overrides whose line cleared), ms and gain a decision.
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
  return [
    ...pairedLines(rep, { who: 'the outside teacher', vs: 'the expert as it ships', a: 'outside', b: 'shipped', more: `${rep.fightsPerRun} fights played in playouts a run` }),
    '  by phase        decided a run  overrode         played a decision  playouts (ended at a fight played)  settled by a clear  found a clear  ms a decision  value gained a decision',
    ...PHASES.map((p) => {
      const x = rep.phases[p]
      return `    ${p.padEnd(13)} ${String(x.perRun).padStart(8)}  ${String(x.overrides).padStart(5)}/${String(x.decided).padEnd(6)} (${pc(x.overrideRate)})  ${String(x.candidates ?? '-').padStart(8)}  ${String(x.playouts).padStart(14)} (${pc(x.hitRate)})  ${String(x.settled).padStart(12)}  ${String(x.found ?? '-').padStart(13)}  ${String(x.msPerDecision ?? '-').padStart(14)}  ${x.gainPerDecision ?? '-'}`
    })
  ]
}

// ── run directly ─────────────────────────────────────────────────────────────────────────────────

// A worker's job ({ seed, player, rows? }): a run by the outside teacher or the expert, labelled, or read again.
const job = (j, cfg) => (j.player === 'label' ? labelRun(j.seed, cfg) : j.player === 'reread' ? rereadRun(j.seed, j.rows, cfg.cap, cfg.formations) : j.player === 'outside' ? outsideRun(j.seed, cfg) : expertRun(j.seed, { ascension: cfg.ascension ?? 0, ...asMonarch(cfg.monarch) }))

const pool = (jobs, workers, cfg, done) => workerPool(import.meta.url, { outside: true, cfg }, jobs, workers, (_, out) => done(out))

async function main () {
  const labels = has('label') || arg('reread', null)
  if (labels && (Number(arg('ascension', 0)) !== 0 || arg('monarch', BASE_MONARCH) !== BASE_MONARCH)) throw new Error('--label and --reread: the base game as the base Monarch, no --ascension or --monarch')
  if (has('label')) return labelMain(arg)
  if (arg('reread', null)) return rereadMain(arg)
  const seed = arg('seed', 'sim')
  const runs = Number(arg('runs', 64))
  const from = Number(arg('from', 0))
  const workers = Number(arg('workers', 2))
  const dir = arg('out', path.join(os.tmpdir(), `retinue-outside-${seed}`))
  const c = configOf({ phases: arg('phases', PHASES.join(',')), cap: Number(arg('cap', DEFAULTS.cap)), rooms: Number(arg('rooms', DEFAULTS.rooms)), prep: arg('prep', DEFAULTS.prep), won: has('won'), ascension: Number(arg('ascension', 0)), monarch: arg('monarch', BASE_MONARCH) })
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
  if (jobs.length && !has('report-only')) {
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
} else if (isMainThread && isMain(import.meta.url)) {
  await main()
}
