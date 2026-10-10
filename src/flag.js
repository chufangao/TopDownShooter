// The slice's switch (redesign.md §5), read off the page's address before any other module is: ?turns=1 plays the
// battle on turns, ?turns=0 the old one, and without it the tuning's default. main.js imports it first, so every
// module's texts (the glossary, the codex) are built under the flag the page asked for, and the two can be played
// side by side. It goes with the flag.
import { TUNING } from './tuning.js'

const flag = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('turns')
if (flag !== null) TUNING.turns = flag !== '0'
