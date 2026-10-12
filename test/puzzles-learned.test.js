// test/puzzles.test.js again with the expert on V (redesign.md §2.21, §6 step 8b): TUNING.expert.beam.learned, the
// shipped value.json (src/sim/value.js reads it) and TUNING.expert.beam.hybrid, whatever the default is. Functional
// only, as there.
import { TUNING } from '../src/tuning.js'
import { loaded } from '../src/sim/value.js'

TUNING.expert.beam.learned = true
if (!loaded()) throw new Error('puzzles-learned: no trained weights in src/sim/value.json (npm run train)')
await import('./puzzles.test.js')
