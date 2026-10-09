// Keywords: the game's terms, each a bold word in its system's colour with a one-line hover (the
// Slay the Spire style). Write kw('domain') in any text instead of explaining the rule again; the full
// rules live in How to play's glossary. `sys` picks the colour token (--c-<sys> in style.css); `group`
// files the term under a heading of the glossary. Every number comes from TUNING, so a line never drifts.
import { TUNING } from './tuning.js'
import { STATUSES, THREATS, KEYSTONE_LIST } from './content.js'
import { h } from './dom.js'

const M = TUNING.monarch
const RK = TUNING.ranks
const W = TUNING.spawn.waves
const s = (ticks) => `${+(ticks * TUNING.tick.ms / 1000).toFixed(1)} s`
const ks = (id) => KEYSTONE_LIST.find((k) => k.id === id)

export const KEYWORDS = {
  // You
  monarch: { name: 'Monarch', sys: 'monarch', group: 'You', line: 'You. It never strikes or steps, and if it falls the run ends.' },
  domain: { name: 'Domain', sys: 'domain', group: 'You', line: `The square ${M.domain} + Dominion tiles around the Monarch; outside it, yours falter.` },
  falter: { name: 'Falter', sys: 'foe', group: 'You', line: `Outside the domain: ×${M.falter} damage, and it drops its plan to Hunt for good.` },
  approach: { name: 'Approach', sys: 'foe', group: 'You', line: 'The open tiles beside the Monarch, where a melee foe stands to strike it. Holding them stops melee only: shots and sweeping blows reach it from further off.' },
  arise: { name: 'Arise', sys: 'shadow', group: 'You', line: `The Monarch raises a foe's corpse in its domain (tier ≤ ${M.raiseTier} + Will) as a shadow.` },
  shadow: { name: 'Shadow', sys: 'shadow', group: 'You', line: M.shadowFalter ? 'A raised corpse fighting for you: it always falters, and is gone when the battle ends.' : 'A raised corpse fighting for you: it falters outside the domain, and is gone when the battle ends.' },
  dominion: { name: 'Dominion', sys: 'monarch', group: 'You', line: 'Each point widens the domain by a tile.' },
  command: { name: 'Command', sys: 'monarch', group: 'You', line: `Each point: a soul more on the field (at most ${TUNING.army.board}).` },
  will: { name: 'Will', sys: 'monarch', group: 'You', line: `Each point: ${M.raises} more raises a battle, a tier higher, and Arise ${Math.round(M.willHaste * 100)}% sooner.` },
  // The army
  ossuary: { name: 'Ossuary', sys: 'ossuary', group: 'Army', line: `Your souls not on the field: kept, never fighting. Field and ossuary hold ${TUNING.party.roster}.` },
  summon: { name: 'Summon', sys: 'path', group: 'Army', line: 'Raised by a path tier beside its soul each battle; it keeps to it and is gone after.' },
  banner: { name: 'Banner', sys: 'orders', group: 'Army', line: 'A Marshal, its summons and the shadows that join it.' },
  captain: { name: 'Captain', sys: 'orders', group: 'Army', line: 'Who leads others: a foe captain its cohort, a soul its summons. They falter if it falls.' },
  // Orders
  detachment: { name: 'Detachment', sys: 'orders', group: 'Orders', line: `Up to ${TUNING.army.detachments} groups of souls, each with one plan: where, and when.` },
  hunt: { name: 'Hunt', sys: 'orders', group: 'Orders', line: 'Each walks as its role does, to the foe. The default.' },
  stay: { name: 'Stay', sys: 'orders', group: 'Orders', line: 'Hold the starting tile, braced; step out to fight, then walk back.' },
  move: { name: 'Move', sys: 'orders', group: 'Orders', line: 'Walk to a square; on it or beside it, Hunt.' },
  braced: { name: 'Braced', sys: 'orders', group: 'Orders', line: `On Stay within ${TUNING.orders.post} tile of its post: ×${TUNING.orders.braced} damage taken${TUNING.orders.holdFlank ? ', and no flanker slips past' : ''}.` },
  held: { name: 'Held', sys: 'orders', group: 'Orders', line: `A later start: it waits behind the camp, then enters fresh (full gauge, Shielded ${s(TUNING.orders.fresh)}).` },
  // Battle
  gauge: { name: 'Gauge', sys: 'gauge', group: 'Battle', line: 'Fills with SPD; a unit acts when it covers its next ability.' },
  engaged: { name: 'Engaged', sys: 'foe', group: 'Battle', line: 'A foe next to it: it cannot walk away (a flanker can).' },
  escalation: { name: 'Escalation', sys: 'foe', group: 'Battle', line: `From ${s(TUNING.escalation.startTick)} after the last entry (${s(TUNING.escalation.startTick * TUNING.escalation.bossMult)} in the boss's room), all damage climbs to ×${TUNING.escalation.max}.` },
  ceiling: { name: 'Ceiling', sys: 'foe', group: 'Battle', line: `Still undecided ${s(TUNING.tick.ceiling)} after the last foe entered: a defeat.` },
  // The foes
  wave: { name: 'Wave', sys: 'foe', group: 'Foes', line: `From floor ${W.floor}: more foes at the far edge once the last wave is down to a third, or after ${s(W.t)}.` },
  latepair: { name: 'Late pair', sys: 'foe', group: 'Foes', line: `A floor-1 elite's ${TUNING.spawn.late.n} extra foes, arriving at ${s(TUNING.spawn.late.t)}.` },
  siege: { name: 'Siege', sys: 'foe', group: 'Foes', line: `One battle of ${W.siege} waves with no prep between, paid with the win.` },
  // Growth
  essence: { name: 'Essence', sys: 'essence', group: 'Growth', line: 'Paid by slain foes; buys levels, tiers, ranks, recruits and the Monarch.' },
  path: { name: 'Path', sys: 'path', group: 'Growth', line: 'One of a kind\'s upgrade lines: its first tier rules out the others, though a Knight or Marshal may add a second.' },
  tier: { name: 'Tier', sys: 'path', group: 'Growth', line: `A path's step, I–IV (${TUNING.essence.tier.join(' / ')} essence); a kind's own tier (1–5) also sets Arise and recruits.` },
  soldier: { name: 'Soldier', sys: 'soldier', group: 'Growth', line: 'A soul\'s first rank: tiers I–III on one path.' },
  knight: { name: 'Knight', sys: 'knight', group: 'Growth', line: `Level ${RK.level[0]}, ${RK.cost[0]} essence: ×${RK.might[1]} damage dealt, ÷${RK.might[1]} taken, +${RK.summons[1]} summoned, and tier IV or a second path's tier I.` },
  marshal: { name: 'Marshal', sys: 'marshal', group: 'Growth', line: `Level ${RK.level[1]}, ${RK.cost[1]} essence: its own ${RK.domain}-tile domain, ×${RK.might[2]} dealt, ÷${RK.might[2]} taken, +${RK.summons[2]} summoned, tier IV and a second path's I–III.` },
  synergy: { name: 'Synergy', sys: 'synergy', group: 'Growth', line: 'A bonus for fielding several of one kin or role, in steps at set counts (most at 2, 4, 6 and 8).' },
  rule: { name: 'Rule', sys: 'synergy', group: 'Growth', line: `A synergy's 8th step: it changes what happens. Yours always hold; the foes' only from ${TUNING.spawn.endless.rules} floors into the deep.` },
  bond: { name: 'Bond', sys: 'synergy', group: 'Growth', line: 'A bonus from who stands beside, behind or ahead of a soul.' },
  relic: { name: 'Relic', sys: 'relic', group: 'Growth', line: `A lasting bonus, often a trigger; at most ${TUNING.essence.relicMax}.` },
  keystone: { name: 'Keystone', sys: 'keystone', group: 'Growth', line: `Rewrites one rule for the run; at most ${TUNING.keystone.max}.` },
  undying: { name: 'Undying', sys: 'keystone', group: 'Growth', line: ks('undying').desc }
}

// The threats a room can pose (scouted roles say which) and the statuses, from the content, so they stay true;
// LINE holds the few whose content text says less than the rules do.
const brittle = STATUSES.brittle
const brittleMul = brittle.mods[0].v
const LINE = {
  // Drain: a kind's blows that weaken (gauge, Brittle's DEF, Withered's ATK).
  drain: 'Saps gauge, rots defence or withers attack.',
  // Brittle: its stacks multiply, so three take 58% of DEF, not 75%.
  brittle: `×${brittleMul} DEF per stack, multiplying (${Array.from({ length: brittle.stacks }, (_, k) => `−${Math.round((1 - brittleMul ** (k + 1)) * 100)}%`).join(', ')}), up to ${brittle.stacks} stacks.`
}
for (const [id, t] of Object.entries(THREATS)) KEYWORDS[id] ??= { name: t.name, sys: 'foe', group: 'Threats', line: LINE[id] ?? t.desc }
for (const [id, st] of Object.entries(STATUSES)) KEYWORDS[id] ??= { name: st.name, sys: st.tags.includes('debuff') ? 'foe' : 'synergy', group: 'Statuses', line: LINE[id] ?? st.desc }

// A keyword span: kw('domain'), or kw('domain', 'domains') to show other words for the same term.
export function kw (id, text = null) {
  const k = KEYWORDS[id]
  if (!k) return text ?? id
  return h('span', { class: 'kw', style: `--k:var(--c-${k.sys})`, tip: () => h('div', { class: 'syn-tip kw-tip' }, h('b', { style: `color:var(--c-${k.sys})` }, k.name), ' ', h('span', null, k.line)) }, text ?? k.name)
}
