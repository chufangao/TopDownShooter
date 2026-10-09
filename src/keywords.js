// Keywords: the game's fifteen words (DESIGN §2.11) and the statuses, each a bold word in its system's colour
// with a one-line hover (the Slay the Spire style). Write kw('ring') in any text instead of explaining the rule
// again; the full rules live in the codex's glossary. `sys` picks the colour token (--c-<sys> in style.css);
// `group` files the term under a heading of the glossary. Every number comes from TUNING, so a line never drifts.
import { TUNING } from './tuning.js'
import { STATUSES } from './content.js'
import { h } from './dom.js'

const M = TUNING.monarch
const W = TUNING.spawn.waves
const s = (ticks) => `${+(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`

// The fifteen, in the order a player meets them.
export const KEYWORDS = {
  piece: { name: 'Piece', sys: 'essence', line: 'One kind on one tile, as many bodies as its count: souls of yours, or foes.' },
  ring: { name: 'Ring', sys: 'orders', line: 'How far a piece fights, in tiles. It fights whatever stands in its ring; otherwise it follows its line.' },
  line: { name: 'Line', sys: 'orders', line: 'The march you draw for a piece. It walks it a tile at a time and holds at its end; with none, it holds its tile.' },
  signal: { name: 'Signal', sys: 'orders', line: 'What a line waits for before it starts: a time, the first blow, a wave, the Monarch struck, or one of yours fallen.' },
  road: { name: 'Road', sys: 'foe', line: 'The arrows the foes walk to the Monarch. Walls bend them; your pieces do not.' },
  wave: { name: 'Wave', sys: 'foe', line: `More foes over the far edge, once the last wave is down to a third or after ${s(W.t)}.` },
  domain: { name: 'Domain', sys: 'domain', line: `The square ${M.domain} + Dominion tiles around the Monarch: a foe that falls inside it may rise as a shadow of yours.` },
  shadow: { name: 'Shadow', sys: 'shadow', line: 'A foe risen in your domain. It holds where it rose, fights for you, and is gone when the battle ends.' },
  stack: { name: 'Stack', sys: 'essence', line: 'The bodies in one piece. Their HP is one pool; they fall one at a time, and a smaller stack hits softer.' },
  banner: { name: 'Banner', sys: 'orders', line: 'A tier IV: the piece leads, and the pieces placed beside it follow its line.' },
  essence: { name: 'Essence', sys: 'essence', line: 'Paid by slain foes; buys levels, tiers, recruits and the Monarch\'s points.' },
  tier: { name: 'Tier', sys: 'path', line: 'A step, I–IV, on one of a kind\'s two tracks: it upgrades every soul of that kind.' },
  synergy: { name: 'Synergy', sys: 'synergy', line: 'A bonus for fielding pieces of one kin or role, in steps at 2, 4, 6 and 8. Its pieces glow in its colour.' },
  relic: { name: 'Relic', sys: 'relic', line: `A lasting bonus, often a trigger; at most ${TUNING.essence.relicMax}.` },
  keystone: { name: 'Keystone', sys: 'keystone', line: `Rewrites one rule for the run; at most ${TUNING.keystone.max}.` }
}
for (const k of Object.values(KEYWORDS)) k.group = 'Words'

// The statuses, from the content, so they stay true; LINE holds the few whose content text says less than the
// rules do.
const brittle = STATUSES.brittle
const brittleMul = brittle.mods[0].v
const LINE = {
  // Its stacks multiply, so three take 58% of DEF, not 75%.
  brittle: `×${brittleMul} DEF per stack, multiplying (${Array.from({ length: brittle.stacks }, (_, k) => `−${Math.round((1 - brittleMul ** (k + 1)) * 100)}%`).join(', ')}), up to ${brittle.stacks} stacks.`
}
for (const [id, st] of Object.entries(STATUSES)) KEYWORDS[id] ??= { name: st.name, sys: st.tags.includes('debuff') ? 'foe' : 'synergy', group: 'Statuses', line: LINE[id] ?? st.desc }

// A keyword span: kw('ring'), or kw('ring', 'rings') to show other words for the same term. An id that is no
// keyword is plain text.
export function kw (id, text = null) {
  const k = KEYWORDS[id]
  if (!k) return text ?? id
  return h('span', { class: 'kw', style: `--k:var(--c-${k.sys})`, tip: () => h('div', { class: 'syn-tip kw-tip' }, h('b', { style: `color:var(--c-${k.sys})` }, k.name), ' ', h('span', null, k.line)) }, text ?? k.name)
}
