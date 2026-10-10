// Keywords: the game's words (DESIGN §2.9; on turns the seventeen of redesign.md §2.14), the foes' two ways and the
// statuses, each a bold word in its system's colour with a one-line hover (the Slay the Spire style). Write
// kw('road') in any text instead of explaining the rule again; the full rules live in the codex's glossary. `sys`
// picks the colour token (--c-<sys> in style.css); `group` files the term under a heading of the glossary. Every
// number comes from TUNING, so a line never drifts. Built once, under the flag the page asked for (flag.js).
import { TUNING } from './tuning.js'
import { STATUSES, BEHAVIOURS } from './content.js'
import { h } from './dom.js'

const W = TUNING.spawn.waves
// Seconds to a tenth, whole ones without the tenth: "0.8 s", "120 s".
export const secs = (ticks) => `${+(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`

// The words, in the order a player meets them: on turns the seventeen (Ring and the gauge gone; Turn, Move, Skill,
// Cooldown, Counter and Shop come), else the old twelve and the Shop.
const turns = TUNING.turns
const held = turns ? 'It acts on its own each turn' : 'It holds there'
export const KEYWORDS = {
  piece: { name: 'Piece', sys: 'essence', line: turns ? 'One soul on one cell, or four for a 2×2. On your turn each moves up to its Move, then acts once.' : 'One soul on one cell, or four for a 2×2. Yours never move: each fights from where you put it, all battle.' },
  ...(!turns && { ring: { name: 'Ring', sys: 'plan', line: 'How far a piece fights, in tiles from its footprint: its ranged blows to their range, its melee only beside it (two tiles for a long arm). A foe walking into it halts there once it can strike something of yours, but only as far as a blow that needs no condition reaches.' } }),
  road: {
    name: 'Road', sys: 'foe',
    line: turns ? 'The arrows the foes walk to the Monarch. A foe keeps to its road: how far it comes each turn is its choice, where it goes is the road\'s. Your pieces block it; the dead never do.'
      : 'The arrows the foes walk to the Monarch, doing nothing else until they can hit back: in a ring of yours with something in reach, or with the way ahead held. Walls bend them; your pieces do not.'
  },
  wave: { name: 'Wave', sys: 'foe', line: turns ? 'More foes over the far edge as a set turn begins: the wave counter says which.' : `More foes over the far edge, once the last wave is down to a third or after ${secs(W.t)}; a floor-1 elite's late pair at a set time. The scouts tell each wave's coming.` },
  shadow: { name: 'Shadow', sys: 'shadow', line: `A slain foe risen to fight for you, on the free tile nearest the Monarch. ${held}, and is gone when the battle ends.` },
  summon: { name: 'Summon', sys: 'shadow', line: `A shadow of its own kind that a tier calls up beside a piece of yours as each battle begins, at ${Math.round(TUNING.summon.hp * 100)}% of its HP. ${held}, and is gone when the battle ends.` },
  essence: { name: 'Essence', sys: 'essence', line: 'Paid by every foe slain, by its tier; buys tiers, fusions, recruits and relics, every price dearer each floor down.' },
  tier: { name: 'Tier', sys: 'path', line: 'A step, I–IV, on one of a kind\'s two tracks: it upgrades every soul of that kind and raises the kind\'s level.' },
  fusion: { name: 'Fusion', sys: 'path', line: 'A recipe: souls of set kinds become one much stronger piece, most of them 2×2. The Codex lists every one.' },
  synergy: { name: 'Synergy', sys: 'synergy', line: 'A bonus for fielding pieces of one kin or role, in steps at 2, 4, 6 and 8. Its pieces glow in its colour.' },
  relic: { name: 'Relic', sys: 'relic', line: 'A lasting bonus bought in a Shop, often a trigger: Common, Uncommon, Rare, or Legendary, a rule that rewrites the game. Copies add up.' },
  command: { name: 'Command', sys: 'monarch', line: `How many pieces the Monarch fields: ${TUNING.party.field} to begin, more with each Command relic, at most ${TUNING.army.board}.` },
  ...(turns && {
    turn: { name: 'Turn', sys: 'plan', line: `Yours, then the foes'. Give your pieces their orders, then End Turn: what you left alone strikes with its basic blow, then the foes move and strike. A battle still undecided ${TUNING.turn.cap} turns after the last wave entered is lost.` },
    move: { name: 'Move', sys: 'plan', line: 'How many tiles a piece may go in a turn, before it acts: through your own pieces, never through a foe, never diagonally past a wall\'s corner. A move may be undone until the piece acts.' },
    skill: { name: 'Skill', sys: 'plan', line: 'Any act but a piece\'s basic blow and basic heal. Only your orders use one: a piece left alone never does. Every skill rests a turn once used.' },
    cooldown: { name: 'Cooldown', sys: 'plan', line: 'The turn a skill rests once used: its pip goes dark, and lights again when it is ready.' },
    counter: { name: 'Counter', sys: 'foe', line: 'A melee blow whose target stands and can reach back is answered at once by its basic melee blow, both sides alike. A ranged blow never is; a Hexed piece never answers; a counter is never countered.' }
  }),
  shop: { name: 'Shop', sys: 'relic', line: `A room that sells relics for essence, ${TUNING.shop.relics} on its shelf, one always a Command relic: buy as many as you can pay for. Leaving is free.` }
}
for (const k of Object.values(KEYWORDS)) k.group = 'Words'

// The foes' ways on the board (content.js BEHAVIOURS): what each does, and what a foe's melee strikes on it, never
// which kinds do it (that is learnt by meeting them, and the bestiary keeps it).
// On turns a foe's way is only where it goes (how far, and whether it comes in at all, is its judgement: the
// bestiary's way line), and nothing halts it but a piece in its way.
const TURN_WAYS = {
  walk: 'Comes down the arrows to the Monarch, as far as it chooses each turn and never off them; a piece of yours in its way blocks it.',
  fly: 'Flies the air road straight at the Monarch over the walls, never through your pieces. Only a ranged blow, or a flyer\'s melee, can strike it.'
}
for (const [id, b] of Object.entries(BEHAVIOURS)) KEYWORDS[id] ??= { name: b.name, sys: 'foe', group: 'Behaviours', line: turns && TURN_WAYS[id] ? TURN_WAYS[id] : [b.desc, b.melee].filter(Boolean).join(' ') }

// The statuses, from the content, so they stay true; LINE holds the few whose content text says less than the
// rules do.
const brittle = STATUSES.brittle
const brittleMul = brittle.mods[0].v
const LINE = {
  // Its stacks multiply, so three take 58% of DEF, not 75%.
  brittle: `×${brittleMul} DEF per stack, multiplying (${Array.from({ length: brittle.stacks }, (_, k) => `−${Math.round((1 - brittleMul ** (k + 1)) * 100)}%`).join(', ')}), up to ${brittle.stacks} stacks.`
}
for (const [id, st] of Object.entries(STATUSES)) KEYWORDS[id] ??= { name: st.name, sys: st.tags.includes('debuff') ? 'foe' : 'synergy', group: 'Statuses', line: LINE[id] ?? st.desc }

// A keyword span: kw('road'), or kw('road', 'roads') to show other words for the same term. An id that is no
// keyword (Ring on turns) is plain text.
export function kw (id, text = null) {
  const k = KEYWORDS[id]
  if (!k) return text ?? id
  return h('span', { class: 'kw', style: `--k:var(--c-${k.sys})`, tip: () => h('div', { class: 'syn-tip kw-tip' }, h('b', { style: `color:var(--c-${k.sys})` }, k.name), ' ', h('span', null, k.line)) }, text ?? k.name)
}
