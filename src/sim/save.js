// A run saved (redesign.md §4.8). A run is its createRun options and its log of actions (run.js replay), so a save is
// those two and nothing more of the state: written after every action (main.js), read back by playing the log again
// from the options, the battle under way order by order. Beside them it keeps where the run stood (`at`), for the
// title's Continue to name, and to check the replay against: a save whose log no longer plays (an older game's: its
// maps, its offers or its battles no longer the same) is no save, and is set aside with a note, never a crash.
//
//   { v, run, log, at }
//   v     SAVE_VERSION; any other is an older game's
//   run   the options the run was made with, whatever createRun takes ({ seed, start?, scale?… }), so a level or a
//         difficulty rides along
//   log   run.state.log, every action applied, battle orders among them
//   at    placeOf: the floor, the room's rank, the phase, the battle's turn, the purse, the Monarch's HP, the actions
//
// The tutorial is never saved, and a finished run (cleared or lost: phase 'over') has no save.
import { replay, monarchOf, currentNode } from './run.js'

export const SAVE_VERSION = 1

// Where a run stands, as a save keeps it: the floor, the rank of the room it stands in (0: the floor's start), the
// phase, the battle's turn (null out of battle), the purse, the Monarch's HP, and how many actions it took.
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

// Whether a run is one a save keeps: a run under way (not over), and no tutorial.
export const keeps = (run) => !!run && !run.state.tutorial && run.state.phase !== 'over'

// The save of `run`, made with createRun options `made`, as the JSON text it is kept as; null for a run not kept.
export function saveOf (run, made) {
  if (!keeps(run)) return null
  return JSON.stringify({ v: SAVE_VERSION, run: { ...made, seed: run.state.seed }, log: run.state.log, at: placeOf(run) })
}

// A save's text played back: { run, made, at } (the run as it stood, its options, where it stood), or { error, why }:
// 'unreadable' (not a save's text), 'outdated' (another version's, or a log that no longer plays the same: it throws,
// or ends elsewhere than it says), or 'over' (a run already finished). Never throws.
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
  return { run, made: save.run, at }
}
