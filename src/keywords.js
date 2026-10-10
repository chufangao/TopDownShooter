// Keywords: the game's thirteen words (DESIGN §2.9), the foes' three ways and the statuses, each a bold word in its
// system's colour with a one-line hover (the Slay the Spire style). Write kw('ring') in any text instead of
// explaining the rule again; the full rules live in the codex's glossary. `sys` picks the colour token
// (--c-<sys> in style.css); `group` files the term under a heading of the glossary. Every number comes from
// TUNING, so a line never drifts.
import { TUNING } from './tuning.js'
import { STATUSES, BEHAVIOURS } from './content.js'
import { h } from './dom.js'

const M = TUNING.monarch
const W = TUNING.spawn.waves
const s = (ticks) => `${+(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`

// The thirteen, in the order a player meets them.
export const KEYWORDS = {
  piece: { name: 'Piece', sys: 'essence', line: 'One kind on one cell, or four for a 2×2, as many bodies as its count. Yours never move: each fights from where you put it, all battle.' },
  stack: { name: 'Stack', sys: 'essence', line: 'The bodies in one piece. Their HP is one pool; they fall one at a time, and a smaller stack hits softer.' },
  ring: { name: 'Ring', sys: 'plan', line: 'How far a piece reaches, in tiles from its footprint. It fights whatever it can strike in its ring; otherwise it waits.' },
  road: { name: 'Road', sys: 'foe', line: 'The arrows the foes walk to the Monarch. Walls bend them; your pieces do not.' },
  wave: { name: 'Wave', sys: 'foe', line: `More foes over the far edge, once the last wave is down to a third or after ${s(W.t)}.` },
  domain: { name: 'Domain', sys: 'domain', line: `The square ${M.domain} tiles around the Monarch, wider with Arise's Dominion: while you hold the Arise relic, a foe that falls inside it may rise as a shadow of yours.` },
  shadow: { name: 'Shadow', sys: 'shadow', line: 'A foe risen in your domain, on the free tile nearest the Monarch. It holds there, fights for you, and is gone when the battle ends.' },
  essence: { name: 'Essence', sys: 'essence', line: 'Paid by slain foes; buys tiers, fusions and recruits.' },
  tier: { name: 'Tier', sys: 'path', line: 'A step, I–IV, on one of a kind\'s two tracks: it upgrades every soul of that kind and raises the kind\'s level.' },
  fusion: { name: 'Fusion', sys: 'path', line: 'A recipe: souls of set kinds become one much stronger piece, most of them 2×2. The Codex lists every one.' },
  synergy: { name: 'Synergy', sys: 'synergy', line: 'A bonus for fielding pieces of one kin or role, in steps at 2, 4, 6 and 8. Its pieces glow in its colour.' },
  relic: { name: 'Relic', sys: 'relic', line: 'A lasting bonus, often a trigger: Common, Uncommon, Rare, or Legendary, a rule that rewrites the game. Copies stack.' },
  command: { name: 'Command', sys: 'monarch', line: `How many pieces the Monarch fields: ${TUNING.party.field} to begin, more with each Command relic, at most ${TUNING.army.board}.` }
}
for (const k of Object.values(KEYWORDS)) k.group = 'Words'

// The foes' ways on the board (content.js BEHAVIOURS): what each does, never which kinds do it (that is learnt by
// meeting them, and the bestiary keeps it).
for (const [id, b] of Object.entries(BEHAVIOURS)) KEYWORDS[id] ??= { name: b.name, sys: 'foe', group: 'Behaviours', line: b.desc }

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
