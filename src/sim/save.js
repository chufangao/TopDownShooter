// A run saved: its createRun options and its log of actions, played again on load (run.js replay). Written after every
// action (main.js); never for the tutorial nor a finished run. A save whose log no longer plays is set aside, never a crash.
//   { v, run, log, at, meta? }
//   v     SAVE_VERSION; any other is an older game's
//   run   the options the run was made with ({ seed, start?, scale?, ascension?, monarch?… })
//   log   run.state.log, every action applied, battle orders among them
//   at    placeOf(run): where the run stood, for the title's Continue and to check the replay against
//   meta  what the interface keeps with the run (main.js), handed back as it was given
import { replay, monarchOf, currentNode } from './run.js'

// Raised whenever an older save's log may no longer play the same.
export const SAVE_VERSION = 8

// Where a run stands, as a save keeps it. room: the rank of its room (0: the floor's start); turn: null out of battle.
export function placeOf (run) {
  const s = run.state
  return {
    floor: s.floor,
    room: s.map ? currentNode(run)?.rank ?? 0 : 0,
    phase: s.phase,
    turn: s.phase === 'battle' ? run.battle.turn : null,
    essence: s.essence,
    hp: monarchOf(s).hp,
    actions: s.log.length
  }
}

export const keeps = (run) => !!run && !run.state.tutorial && run.state.phase !== 'over'

// The save of `run` (made with createRun options `made`) as its JSON text; null for a run not kept.
export function saveOf (run, made, meta = null) {
  if (!keeps(run)) return null
  return JSON.stringify({ v: SAVE_VERSION, run: { ...made, seed: run.state.seed }, log: run.state.log, at: placeOf(run), ...(meta && { meta }) })
}

// A save's text played back: { run, made, at, meta } (meta null for none), or { error, why }, error 'unreadable', 'outdated'
// (another version's, or a log that throws or plays elsewhere than `at`) or 'over' (a finished run). Never throws.
export function restore (text) {
  let save
  try {
    save = JSON.parse(text)
  } catch (e) {
    return { error: 'unreadable', why: e.message }
  }
  if (!save || typeof save !== 'object' || typeof save.run?.seed !== 'string' || !Array.isArray(save.log) || !save.at) {
    return { error: 'unreadable', why: 'not a save' }
  }
  if (save.v !== SAVE_VERSION) return { error: 'outdated', why: `version ${save.v}` }
  if (save.at.phase === 'over') return { error: 'over', why: 'a finished run' }
  let run
  try {
    run = replay(save.run.seed, save.log, save.run)
  } catch (e) {
    return { error: 'outdated', why: `its log no longer plays: ${e.message}` }
  }
  const at = placeOf(run)
  const off = Object.keys(save.at).filter((k) => at[k] !== save.at[k])
  if (off.length || !keeps(run)) return { error: 'outdated', why: `it plays to another place (${off.join(', ') || at.phase})` }
  return { run, made: save.run, at, meta: save.meta && typeof save.meta === 'object' ? save.meta : null }
}
