// The learned expert's value of a board (redesign.md §2.21): V(board), how good a battle's board is for your side,
// learned offline (npm run train) and shipped as weights in value.json. This file is the contract between the learner
// (who fills it: the encoding, the network, training) and the player (policy.js expertTurn, which scores afterstates
// by `value` and falls back to its static board evaluation while `value` returns null).
//
//   FEATURES          the names of V's inputs, in order
//   encode(battle)    → a Float32Array of FEATURES.length: what a player of your side sees (never the camp's pressure,
//                       never its coming turn)
//   value(battle)     → V for your side, a number (higher is better), or null while no weights are trained
//   loaded()          → whether trained weights are in use
//
// The player's recording hook, for the learner's data (policy.js expertTurn's options): `record(battle, info)` is
// called at each piece's decision with the board before it decides (info: { uid, options, chosen }), and
// `explore: { rng, epsilon, top }` makes the turn take a random one of its top options with chance epsilon.

export const FEATURES = []

export const encode = (battle) => new Float32Array(0)

export const value = (battle) => null

export const loaded = () => false
