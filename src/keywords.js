// Keywords: the game's words, the foes' ways and the statuses, each a bold word in its system's colour with a one-line
// hover. Write kw('road') in any text instead of explaining the rule again; the codex's glossary holds the full rules.
// `sys` picks the colour token (--c-<sys>), `group` the glossary heading; every number comes from TUNING.
import { TUNING } from './tuning.js'
import { STATUSES, BEHAVIOURS, TOP_TIER, TRINE_RISE } from './content.js'
import { h } from './dom.js'

// "3 turns", "all battle".
export const turnsText = (n) => (n === 'battle' ? 'all battle' : n == null ? '' : `${n} turn${n === 1 ? '' : 's'}`)
// "for 3 turns", "for the battle".
export const forTurns = (n) => (n === 'battle' ? 'for the battle' : `for ${turnsText(n)}`)

// The words, in the order a player meets them.
export const KEYWORDS = {
  piece: { name: 'Piece', sys: 'essence', line: 'One soul on one cell, or four for a 2×2. On your turn each walks, then acts once, out of its energy.' },
  road: { name: 'Road', sys: 'foe', line: 'The arrows the foes walk to the Monarch. A foe keeps to its road: how far it comes each turn is its choice, where it goes is the road\'s. Your pieces block it; the dead never do.' },
  wave: { name: 'Wave', sys: 'foe', line: 'More foes over the far edge as a set turn begins: the wave counter says which.' },
  shadow: { name: 'Shadow', sys: 'shadow', line: 'A slain foe risen to fight for you where it fell (or on the free tile nearest it): one your Arise Claimed, or one Undead 4 or a relic raised. It takes no orders: at End Turn it walks toward the nearest foe and strikes one in reach, and is gone when the battle ends.' },
  summon: { name: 'Summon', sys: 'shadow', line: `A shadow of its own kind (a trine's: of the kind it was made of) that a tier calls up beside a piece of yours as each battle begins, at ${Math.round(TUNING.summon.hp * 100)}% of its HP. It acts on its own each turn, and is gone when the battle ends.` },
  essence: { name: 'Essence', sys: 'essence', line: 'Paid by every foe slain, by its tier; buys tiers, fusions, recruits and relics, every price dearer each floor down.' },
  tier: { name: 'Tier', sys: 'path', line: 'A step, I–IV, on one of a soul\'s two tracks: it upgrades that soul alone and raises its level.' },
  fusion: { name: 'Fusion', sys: 'path', line: 'A recipe: souls of set kinds become one much stronger piece, most of them 2×2. The Codex lists every one.' },
  trine: { name: 'Trine', sys: 'path', line: `Three of a kind fused: one piece ${TRINE_RISE} tiers higher, its blows at one foe now strike a crowd and its shots reach a tile farther. It counts as three toward synergies. Every kind of tier ${TOP_TIER - TRINE_RISE} or less has one.` },
  synergy: { name: 'Synergy', sys: 'synergy', line: 'Four pieces of one kin or role on the board bring its rule, which changes what happens, a trine counting as three. Its pieces glow in its colour.' },
  relic: { name: 'Relic', sys: 'relic', line: `Bought in the Shop: Common, Uncommon, Rare or Legendary. A run relic works for the whole run; a piece relic works only through the soul holding it, ${TUNING.relic.perPiece === 1 ? 'one' : TUNING.relic.perPiece} a soul, given and taken back out of battle.` },
  command: { name: 'Command', sys: 'monarch', line: `How many pieces the Monarch fields: ${TUNING.party.field} to begin, more with each Command relic, at most ${TUNING.army.board}.` },
  turn: { name: 'Turn', sys: 'plan', line: `Yours, then the foes'. Give your pieces their orders, then End Turn: what you left alone strikes with its basic blow (or mends with its basic heal) if its energy left pays for it, then the foes move and strike. A battle lasts until no foe is left, the Monarch falls, or nothing of yours but the Monarch stands.` },
  energy: { name: 'Energy', sys: 'plan', line: `A piece\'s budget each turn, ${TUNING.energy.base} plus its Move: a tile walked costs ${TUNING.energy.tile}, its basic blow or heal ${TUNING.energy.basic}, a skill ${TUNING.energy.skill}. It walks first and acts once; what it cannot pay for, it cannot do.` },
  move: { name: 'Move', sys: 'plan', line: 'The tiles a piece may walk and still strike: through your own pieces, never through a foe, never diagonally past a wall\'s corner. A walk may be undone until the piece acts.' },
  skill: { name: 'Skill', sys: 'plan', line: 'Any act but a piece\'s basic blow and basic heal. Only your orders use one: a piece left alone never does. Every skill rests a turn once used.' },
  cooldown: { name: 'Cooldown', sys: 'plan', line: 'The turn a skill rests once used: its pip goes dark, and lights again when it is ready.' },
  counter: { name: 'Counter', sys: 'foe', line: 'A melee blow whose target stands and can reach back is answered at once by its basic melee blow, both sides alike. A ranged blow never is; a Hexed piece never answers; a counter is never countered.' },
  line: { name: 'Line of fire', sys: 'plan', line: 'A ranged blow at one target flies straight from the shooter: the first piece of the target\'s side on a tile it crosses takes it instead, both sides alike. A side never blocks its own shots. Melee, a blow that strikes an area and a lobbed blow ignore lines.' },
  key: { name: 'Key', sys: 'foe', group: 'Words', line: 'A status another piece of the striker\'s side laid in that side\'s own turn, struck in the same turn: never a counter\'s. A blow keyed to it deals its multiple and spends it: the payoff a combo is played for, two pieces\' acts in one turn, never one piece\'s.' },
  lock: { name: 'Lock', sys: 'foe', group: 'Words', line: 'A foe that takes a share of all damage but a status\'s tick, and all of it while one of its keys is on it as a Key (opening spends none). Never a wall: unkeyed it is a slog; one piece lays the key, the rest strike it whole, a keyed blow for its multiple.' },
  shop: { name: 'Shop', sys: 'relic', line: `Open between battles, never in one: the floor's shelf of ${TUNING.shop.relics} relics for essence, one always a Command relic, a slot bought filled again after your next win; and every fusion whose parts you hold. Buy as many as you can pay for.` },
  altar: { name: 'Altar', sys: 'path', line: 'A room with no battle that grants one rite of three: heal the Monarch; transmute a soul into another kind of its tier from this floor\'s foes; or consecrate a soul, its next tier free.' }
}
for (const k of Object.values(KEYWORDS)) k.group = 'Words'

// The foes' ways: where each goes, never which kinds do it (that is learnt by meeting them).
for (const [id, b] of Object.entries(BEHAVIOURS)) KEYWORDS[id] ??= { name: b.name, sys: 'foe', group: 'Behaviours', line: b.desc }

// The statuses, each with how long it lasts; LINE replaces the few whose content text says less than the rules do.
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

// A keyword span: kw('road'), or kw('road', 'roads') to show other words for the same term; an unknown id is plain text.
export function kw (id, text = null) {
  const k = KEYWORDS[id]
  if (!k) return text ?? id
// Foe red as words is its pale tint (--c-foe2): the red itself reads too dark on the panels.
  const c = `var(--c-${k.sys === 'foe' ? 'foe2' : k.sys})`
  return h('span', { class: 'kw', style: `--k:${c}`, tip: () => h('div', { class: 'syn-tip kw-tip' }, h('b', { style: `color:${c}` }, k.name), ' ', h('span', null, k.line)) }, text ?? k.name)
}
