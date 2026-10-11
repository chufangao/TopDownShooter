// Keywords: the game's words (the seventeen of redesign.md §2.14), the foes' two ways and the statuses, each a bold
// word in its system's colour with a one-line hover (the Slay the Spire style). Write kw('road') in any text instead
// of explaining the rule again; the full rules live in the codex's glossary. `sys` picks the colour token (--c-<sys>
// in style.css); `group` files the term under a heading of the glossary. Every number comes from TUNING, so a line
// never drifts.
import { TUNING } from './tuning.js'
import { STATUSES, BEHAVIOURS } from './content.js'
import { h } from './dom.js'

// "3 turns", "all battle".
export const turnsText = (n) => (n === 'battle' ? 'all battle' : n == null ? '' : `${n} turn${n === 1 ? '' : 's'}`)

// The words, in the order a player meets them.
export const KEYWORDS = {
  piece: { name: 'Piece', sys: 'essence', line: 'One soul on one cell, or four for a 2×2. On your turn each moves up to its Move, then acts once.' },
  road: { name: 'Road', sys: 'foe', line: 'The arrows the foes walk to the Monarch. A foe keeps to its road: how far it comes each turn is its choice, where it goes is the road\'s. Your pieces block it; the dead never do.' },
  wave: { name: 'Wave', sys: 'foe', line: 'More foes over the far edge as a set turn begins: the wave counter says which.' },
  shadow: { name: 'Shadow', sys: 'shadow', line: 'A slain foe risen to fight for you, on the free tile nearest the Monarch. It acts on its own each turn, and is gone when the battle ends.' },
  summon: { name: 'Summon', sys: 'shadow', line: `A shadow of its own kind that a tier calls up beside a piece of yours as each battle begins, at ${Math.round(TUNING.summon.hp * 100)}% of its HP. It acts on its own each turn, and is gone when the battle ends.` },
  essence: { name: 'Essence', sys: 'essence', line: 'Paid by every foe slain, by its tier; buys tiers, fusions, recruits and relics, every price dearer each floor down.' },
  tier: { name: 'Tier', sys: 'path', line: 'A step, I–IV, on one of a kind\'s two tracks: it upgrades every soul of that kind and raises the kind\'s level.' },
  fusion: { name: 'Fusion', sys: 'path', line: 'A recipe: souls of set kinds become one much stronger piece, most of them 2×2. The Codex lists every one.' },
  synergy: { name: 'Synergy', sys: 'synergy', line: 'Four pieces of one kin or role on the board bring its rule, which changes what happens. Its pieces glow in its colour.' },
  relic: { name: 'Relic', sys: 'relic', line: `Bought in a Shop: Common, Uncommon, Rare or Legendary. A run relic works for the whole run; a piece relic works only through the soul holding it, ${TUNING.relic.perPiece === 1 ? 'one' : TUNING.relic.perPiece} a soul, given and taken back out of battle.` },
  command: { name: 'Command', sys: 'monarch', line: `How many pieces the Monarch fields: ${TUNING.party.field} to begin, more with each Command relic, at most ${TUNING.army.board}.` },
  turn: { name: 'Turn', sys: 'plan', line: `Yours, then the foes'. Give your pieces their orders, then End Turn: what you left alone strikes with its basic blow (or mends with its basic heal), then the foes move and strike. A battle still undecided ${TUNING.turn.cap} turns after the last wave entered is lost.` },
  move: { name: 'Move', sys: 'plan', line: 'How many tiles a piece may go in a turn, before it acts: through your own pieces, never through a foe, never diagonally past a wall\'s corner. A move may be undone until the piece acts.' },
  skill: { name: 'Skill', sys: 'plan', line: 'Any act but a piece\'s basic blow and basic heal. Only your orders use one: a piece left alone never does. Every skill rests a turn once used.' },
  cooldown: { name: 'Cooldown', sys: 'plan', line: 'The turn a skill rests once used: its pip goes dark, and lights again when it is ready.' },
  counter: { name: 'Counter', sys: 'foe', line: 'A melee blow whose target stands and can reach back is answered at once by its basic melee blow, both sides alike. A ranged blow never is; a Hexed piece never answers; a counter is never countered.' },
  shop: { name: 'Shop', sys: 'relic', line: `A room that sells relics for essence, ${TUNING.shop.relics} on its shelf, one always a Command relic: buy as many as you can pay for. Leaving is free.` }
}
for (const k of Object.values(KEYWORDS)) k.group = 'Words'

// The foes' ways on the board (content.js BEHAVIOURS): where each goes, never which kinds do it (that is learnt by
// meeting them, and the bestiary keeps it); how far it comes, and whether it comes in at all, is its judgement.
for (const [id, b] of Object.entries(BEHAVIOURS)) KEYWORDS[id] ??= { name: b.name, sys: 'foe', group: 'Behaviours', line: b.desc }

// The statuses, from the content, so they stay true, each with how long it lasts; LINE holds the few whose content
// text says less than the rules do.
const brittle = STATUSES.brittle
const brittleMul = brittle.mods[0].v
const LINE = {
  // Its stacks multiply, so three take 58% of DEF, not 75%.
  brittle: `×${brittleMul} DEF per stack, multiplying (${Array.from({ length: brittle.stacks }, (_, k) => `−${Math.round((1 - brittleMul ** (k + 1)) * 100)}%`).join(', ')}), up to ${brittle.stacks} stacks.`
}
for (const [id, st] of Object.entries(STATUSES)) {
  const lasts = st.turns === 'battle' ? '' : ` Lasts ${turnsText(st.turns)}.`
  KEYWORDS[id] ??= { name: st.name, sys: st.tags.includes('debuff') ? 'foe' : 'synergy', group: 'Statuses', line: `${LINE[id] ?? st.desc}${lasts}` }
}

// A keyword span: kw('road'), or kw('road', 'roads') to show other words for the same term. An id that is no
// keyword is plain text.
export function kw (id, text = null) {
  const k = KEYWORDS[id]
  if (!k) return text ?? id
  return h('span', { class: 'kw', style: `--k:var(--c-${k.sys})`, tip: () => h('div', { class: 'syn-tip kw-tip' }, h('b', { style: `color:var(--c-${k.sys})` }, k.name), ' ', h('span', null, k.line)) }, text ?? k.name)
}
