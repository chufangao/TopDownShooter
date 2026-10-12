// The ranker (redesign.md §2.23): a learned correction to today's score of each option of a piece's decision, a small
// network over the situation, the option and the piece, trained offline to copy the teacher (teach.js) and shipped as
// weights in ranker.json. This file is the contract between the teacher (teach.js, which plays out under the ranker in
// use) and the player (policy.js choice, which adds the correction where a ranker is in use):
//
//   useRanker(config)   installs a ranker configuration (ranker.json's contents); null: none, today's expert;
//                       undefined: back to ranker.json beside this file, where there is one. → the one in use, or null
//   rankerModel()       → the ranker in use, or null for none
//
// Until the ranker is trained, none is in use and the expert is today's.
let MODEL = null

export function rankerModel () {
  return MODEL
}

export function useRanker (config) {
  MODEL = config ?? null
  return MODEL
}
