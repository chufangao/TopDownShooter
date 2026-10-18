// The DOM side: the title, the run's screen (its Field, Map, Shop and Codex tabs), the spoils, the altar and the end, the
// playback bar and the panels beside the battle, and the parts they share. Screens only read run.state and report
// input upward; the Field sends its actions through act(action), which returns an error message or null. Every
// control has a tooltip saying exactly what it does (rules text lives in codex.js).
import { TUNING } from './tuning.js'
import {
  availableNodes, fieldCap, rosterCap, fielded, inOssuary, currentNode, souls, isMonarch, monarchOf,
  reapedShadows, essenceByWave, canDescend, depthOf, OSSUARY, canAdvance, tierCost, canPlace, canFuse,
  fuseCost, fuseParts, relicCount, levelOf, kindLevel, floorPrice, swapWith, releaseRefund,
  soulOffer, shopOffers, shelfFusions, canBuy, eliteBonus, runStat, unheld, canHold, isRunRelic, heldKinds, foeEssence, payPer, unhealed,
  transmuteOffer, canTransmute, ascensionOf, ascensionTop, priceScale
} from './sim/run.js'
import { RANKS, WIDTH } from './sim/map.js'
import { unitDef, relicDef, fusionDef, KIN, ROLES, FUSION_LIST, RELIC_TIERS, THREATS, MONARCHS, MONARCH_LIST } from './content.js'
import {
  COLS, ROWS, CAMP_ROWS, slotAt, rowOf, isWall, LANES, DEPTH, tileAt, deployTile, wallTiles, onField, tileX, tileY,
  statsOf, tracksOf, canTrack, nextTracks, sizeOf, footprint, footprintSlots,
  campOpen, isMonarchCell, distanceBetween, summonsOf, reachOf, baseStats
} from './sim/unit.js'
import { field } from './sim/field.js'
import { h, fill, icon, portrait, prefs, showTip, hideTip, pinTip, hold, HOLD, touchy, say } from './dom.js'
import { kw } from './keywords.js'
import { sfx } from './sfx.js'
import { music } from './music.js'
// The Field's board: the battle's own, drawn in Phaser (board.js), under a layer that takes the pointer.
import { board } from './board.js'
// The page is scaled whole (frame.js): what is placed over it by a viewport point goes into the frame's px.
import { frame, toLocal } from './frame.js'
import {
  unitCard, partyMods, roomTip, synergyTracker, synergyGroups, relicTip, ROOM, campRowLabel, realmOf,
  MONARCH_TEXT, MONARCH_RULE, deathText, tileText, fieldRule,
  DEEP_TEXT, ROMAN, relicsByTier, alsoOf, TRIGGER_TEXT, codexView, reachText, reachRule, standing, abilityBlocks,
  auraBlock, hpBar, hpAt, summonText, recruitWorth, relicIcon, relicKind, ariseFor, actText, theirText,
  monarchHpText, statTip, recruitSteps, tally, bestiaryCount, roomGain, transmuteWorth, ascensionText, ASCENSION_RULE
} from './codex.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

// `level`: the ascension the run will be played at, `open` the highest the player may choose (run.js openTo), and
// `onLevel(level)` hears each step of the chooser (ascensionChooser). `saved`, `note`, `onContinue`, `onTutorial`:
// the run saved and the tutorial (resumeActions), and a note over the foot (a save set aside, the tutorial done).
// `daily`, `onDaily`, `onHistory(seed)`: the day's daily and the History (metaActions). `monarch`, `monarchs`,
// `onMonarch`, `overlay`: the Monarch the run will be played as, those open, each choice heard, and how the picker is put
// up (monarchChooser). The actions in one row (a run, the daily, the tutorial, the History), what the run is played with
// in a quieter row under it (the Monarch, the ascension, the seed), and the level's line under that.
export function titleScreen ({
  seed, level = 0, open = 0, onLevel = () => {}, onStart, onHelp, saved = null, note = '', onContinue = null, onTutorial = null,
  daily = null, onDaily = null, onHistory = null, monarch = MONARCH_LIST[0].id, monarchs = [MONARCH_LIST[0].id], onMonarch = () => {}, overlay = null
}) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const seedNow = () => input.value.trim() || seed
  const start = () => onStart(seedNow())
  const ascension = ascensionChooser({ level, open, onLevel })
  const resume = resumeActions({ saved, onContinue, onTutorial })
  const meta = metaActions({ daily, saved, onDaily, onHistory: onHistory && (() => onHistory(seedNow())) })
  const crown = overlay && monarchChooser({ monarch, open: monarchs, onMonarch, overlay })
  // The four steps of a run, one line each in its system's colour; the terms explain themselves on hover.
  const step = (ico, sys, title, ...text) => h('div', { class: 'step', style: `--s:var(--c-${sys})` }, h('div', { class: 'step-ico' }, icon(ico, 26)), h('div', null, h('b', null, title), h('p', null, text)))
  const el = h('div', { class: 'screen title-screen' },
    h('div', { class: 'title-box' },
      h('div', { class: 'sigil' }, icon('soul', 50)),
      h('h1', { class: 'logo' }, 'RETINUE'),
      resume.banner ?? h('p', { class: 'tagline' }, 'You are the Monarch, a necromancer, and the dead fight for you.', h('br'),
        `Descend ${FLOORS_WORD[TUNING.run.floors] ?? TUNING.run.floors} floors, unmake the Hollow Sovereign, then go on into the deep.`),
      h('div', { class: 'steps brief' },
        step('crown', 'monarch', 'Stand', 'You never strike. The foes come down the ', kw('road', 'roads'), ' to you, and choose when to come in.'),
        step('fight', 'foe', 'Scout', say('Hover', 'Tap'), ' a room to see its foes. What they do, you learn by fighting.'),
        step('start', 'plan', 'Command', 'Place your souls, then fight turn by turn: each piece moves, then strikes. What you leave alone strikes anyway.'),
        step('soul', 'essence', 'Reap', 'The slain pay ', kw('essence'), ', and one of them joins you.')),
      h('div', { class: 'title-actions' },
        h('button', { class: `${saved ? 'ghost' : 'primary'} big`, onclick: start, tip: () => saved ? 'Start a new run with this seed: your saved run ends. (asks first)' : 'Start a new run with this seed. (Enter)' },
          saved ? 'New run' : 'Begin the descent ', !saved && h('kbd', null, 'Enter')),
        meta.daily,
        resume.tutorial,
        meta.history),
      h('div', { class: 'title-actions title-settings' },
        crown?.chooser,
        ascension.chooser,
        h('label', { class: 'seed', tip: () => 'The same seed always makes the same maps, foes and battles. Share one to play the same run.' }, 'seed', input)),
      ascension.line),
    note && h('div', { class: 'note title-note', role: 'status', onclick: (e) => e.currentTarget.remove() }, note),
    cornerButtons(onHelp))
  return { el, key: (e) => { if (e.key === 'Enter') (resume.enter ?? start)() } }
}
const FLOORS_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six']

// What the title offers beside a new run (redesign.md §4.8): the run saved, to Continue where it stands (save.js `at`:
// placeText), in the tagline's place under the name, the primary button (Enter) while there is a save; and the
// tutorial, in the actions' row where How to play stood (the corner's ? and H open it still). → { banner, tutorial,
// enter }: the saved run's banner (null for none), the tutorial's button, and Enter's press (null: a new run).
function resumeActions ({ saved, onContinue, onTutorial }) {
  const banner = saved && onContinue && h('div', { class: 'saved-run' },
    h('button', {
      class: 'primary big continue', onclick: onContinue,
      tip: () => `Go on with your saved run where you left it: ${placeText(saved)}. A run is saved after every move you make. (Enter)`
    }, 'Continue ', h('kbd', null, 'Enter')),
    h('span', { class: 'cont-at' }, h('b', null, 'Your run waits'), ` · ${placeText(saved)}`))
  const tutorial = onTutorial && h('button', {
    class: 'ghost', onclick: onTutorial,
    tip: () => 'One battle before floor 1, with three souls given you and three short screens of text: the camp, the battle, the spoils. Never saved.'
  }, icon('codex', 22), ' Tutorial')
  return { banner: banner || null, tutorial, enter: banner ? onContinue : null }
}

// What the title offers beside a run (redesign.md §4.8, the meta; sim/history.js): the day's daily, and the History.
// `daily`: { day, seed, begun, ran }, today's UTC day and seed, whether its daily is begun here (its first attempt
// made), and that attempt's line in the history once it ended (null before). → { daily, history }, their buttons.
function metaActions ({ daily, saved, onDaily, onHistory }) {
  const practice = !!daily?.begun
  const dailyBtn = daily && onDaily && h('button', {
    class: 'ghost daily-btn', onclick: onDaily,
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `The daily · ${dayText(daily.day)}`),
      h('p', null, `Today's run, the same for everyone: seed ${daily.seed}, at ascension 0 as the Monarch, whatever is chosen here. A new one comes at midnight UTC.`),
      practice ? h('p', null, daily.ran ? `Your daily today: ${endText(daily.ran)}.` : 'Your daily today is begun.', ' Play it again as practice: kept in your History, marked so.')
        : h('p', null, 'Your first run of it today counts as the daily; any after it is practice.'),
      saved && h('p', { class: 'dim' }, 'Your saved run ends if you begin it. (asks first)'))
  }, icon('daily', 22), ' Daily', practice && h('span', { class: 'tag' }, 'practice'))
  const history = onHistory && h('button', {
    class: 'ghost', onclick: onHistory,
    tip: () => 'Every run ended in this browser, cleared, fallen or left, the newest first: how far it went, at what level, the souls it ended with and what felled the Monarch, and the totals.'
  }, icon('history', 22), ' History')
  return { daily: dailyBtn || null, history: history || null }
}

// Where a saved run stands (save.js placeOf), in a line: "Floor 2, room 6 of 15 · in battle, turn 3".
const PHASE_AT = { draft: 'the draft', prep: 'entering a battle', reap: 'the spoils', altar: 'at an altar' }
export function placeText (at) {
  const deep = depthOf(at.floor)
  const floor = `Floor ${at.floor}${deep ? ` (deep ${deep})` : ''}`
  const room = at.room > 0 ? `, room ${at.room} of ${RANKS - 1}` : ''
  const what = at.phase === 'battle' ? `in battle, turn ${at.turn}` : PHASE_AT[at.phase]
  return `${floor}${room}${what ? ` · ${what}` : ''}`
}

// A question over the screen with two answers (a new run over a saved one, the tutorial offered on a first visit): `yes`
// does it, `no` (and a tap outside, or Escape) leaves things as they were; `lead`, the answer the primary button and
// Enter give. → the overlay, for main.js to put up and take down.
export function askOverlay ({ title, text, yes, no, onYes, onNo, lead = 'no' }) {
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onNo() } },
    h('div', { class: 'modal ask', role: 'alertdialog', 'aria-label': title },
      h('h2', { class: 'modal-title' }, title),
      h('p', { class: 'lede' }, text),
      h('div', { class: 'title-actions' },
        h('button', { class: `${lead === 'yes' ? 'primary' : 'ghost'} big`, onclick: onYes }, yes, lead === 'yes' && h('kbd', null, 'Enter')),
        h('button', { class: `${lead === 'no' ? 'primary' : 'ghost'} big`, onclick: onNo }, no, lead === 'no' && h('kbd', null, 'Enter')))))
  // Enter gives the leading answer; Escape, as a tap outside, the other's way: things as they were.
  el.key = (e) => { if (e.key === 'Escape') onNo(); else if (e.key === 'Enter') (lead === 'yes' ? onYes : onNo)() }
  return el
}

// One of the tutorial's three screens (content.js TUTORIAL.screens; redesign.md §4.8), over whatever it explains: its
// title, its lines, which of the three it is, and the one button that lets the player on (`onGo`). → the overlay.
export function tutorialCard ({ screen, step, of = 3, onGo }) {
  const el = h('div', { class: 'overlay tut' },
    h('div', { class: 'modal tut-card', role: 'dialog', 'aria-label': screen.title },
      h('div', { class: 'tut-head' }, h('h2', { class: 'modal-title' }, screen.title), h('span', { class: 'dim tut-step' }, `${step} of ${of}`)),
      screen.lines.map((t) => h('p', null, t)),
      h('div', { class: 'title-actions' }, h('button', { class: 'primary big', onclick: onGo }, `${screen.go} `, h('kbd', null, 'Enter')))))
  el.key = (e) => { if (e.key === 'Enter' || e.key === 'Escape') onGo() }
  return el
}

// The ascension ladder's chooser (redesign.md §4.6), the title's: − and + step the level from 0 to `open`, the highest
// open (a clear opening the one above it), each step heard by `onLevel`; `line`, what the level changes, for under the
// actions, each number in full in the chooser's tip. → { chooser, line }
function ascensionChooser ({ level, open, onLevel }) {
  let asc = Math.min(level, open)
  const num = h('b', { class: 'asc-num' })
  const down = h('button', { class: 'asc-step', 'aria-label': 'Ascension down', onclick: () => shift(-1) }, '−')
  const up = h('button', { class: 'asc-step', 'aria-label': 'Ascension up', onclick: () => shift(1) }, '+')
  const line = h('p', { class: 'asc-line' })
  const locked = () => asc >= open && open < ascensionTop()
  const shift = (d) => {
    if (asc + d < 0 || asc + d > open) return sfx.play('poor')
    asc += d
    onLevel(asc)
    shown()
  }
  const shown = () => {
    num.textContent = asc
    for (const [b, off] of [[down, asc <= 0], [up, asc >= open]]) off ? b.setAttribute('aria-disabled', 'true') : b.removeAttribute('aria-disabled')
    fill(line, icon('levelup', 18), h('b', null, `Ascension ${asc}`), `: ${ascensionText(asc).short}.`,
      locked() && h('span', { class: 'dim' }, ` Clear it to open ${asc + 1}.`))
  }
  const chooser = h('div', {
    class: 'ascension', role: 'group', 'aria-label': 'Ascension',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Ascension ${asc}${asc === ascensionTop() ? ', the top' : ''}`),
      ascensionText(asc).lines.map((l) => h('p', null, l)),
      h('p', { class: 'dim' }, ASCENSION_RULE, ` Open here: 0 to ${open}.`))
  }, h('span', { class: 'asc-lbl' }, 'ascension'), down, num, up)
  shown()
  return { chooser, line }
}

// The Monarch's chooser (redesign.md §4.8; content.js MONARCH_LIST), the title's, beside the ascension's: a button naming
// the Monarch the run will be played as, which puts up the Monarchs (monarchPicker) to choose among those `open` (run.js
// monarchsOpen), the rest shown with the clear that opens them; each choice heard by `onMonarch`. `overlay(el)`: puts the
// picker up over the page, null takes it down (main.js). → { chooser }
function monarchChooser ({ monarch, open, onMonarch, overlay }) {
  let mine = open.includes(monarch) ? monarch : MONARCH_LIST[0].id
  const name = h('span', { class: 'mon-name' })
  const pick = (id) => {
    mine = id
    onMonarch(id)
    fill(name, MONARCHS[id].name)
    overlay(null)
  }
  const chooser = h('button', {
    class: 'ghost mon-btn', 'aria-label': 'Monarch', onclick: () => overlay(monarchPicker({ chosen: mine, open, onPick: pick, onClose: () => overlay(null) })),
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, MONARCHS[mine].name), h('p', null, MONARCHS[mine].line), monarchRules(MONARCHS[mine]),
      h('p', { class: 'dim' }, `Who you are this run. ${open.length} of ${MONARCH_LIST.length} open: a clear opens more.`))
  }, icon('crown', 20), name)
  fill(name, MONARCHS[mine].name)
  return { chooser }
}

// What a Monarch brings (content.js MONARCH_LIST): its relic and its draft's bias, a line each; the base one's none.
function monarchRules (m) {
  const r = m.relic && relicDef(m.relic)
  const times = { 2: 'twice', 3: 'three times', 4: 'four times' }[TUNING.monarchs.bias] ?? `${TUNING.monarchs.bias} times`
  return [
    r && h('p', { class: 'mc-rule' }, h('b', null, 'Starts with '), `the ${r.name}: ${r.desc.charAt(0).toLowerCase()}${r.desc.slice(1)}`),
    m.bias && h('p', { class: 'mc-rule' }, h('b', null, 'Drafts '), `${KIN[m.bias].name} kinds ${times} as often as any other.`),
    !r && !m.bias && h('p', { class: 'mc-rule dim' }, 'No relic, and no kin favoured in the draft.')]
}

// The Monarchs to choose from, over the title (monarchChooser): a card each, its name, its line and what it brings; the
// one `chosen` marked, those not `open` greyed with the clear that opens them. A tap on an open one chooses it
// (`onPick`); Escape, Enter, the close button or a tap outside leave the choice as it was (`onClose`). → the overlay
export function monarchPicker ({ chosen, open, onPick, onClose }) {
  const card = (m) => {
    const ok = open.includes(m.id)
    return h('button', {
      class: 'monarch-card' + (m.id === chosen ? ' on' : '') + (ok ? '' : ' locked'), role: 'radio', 'data-id': m.id,
      'aria-checked': m.id === chosen ? 'true' : 'false', 'aria-disabled': ok ? null : 'true',
      onclick: () => (ok ? onPick(m.id) : sfx.play('poor'))
    },
    h('span', { class: 'mc-head' }, icon('crown', 24), h('b', null, m.name)),
    h('p', { class: 'mc-line' }, m.line),
    monarchRules(m),
    !ok && h('p', { class: 'mc-lock' }, m.unlock ? `Opens with a clear at ascension ${m.unlock} or above.` : 'Opens with your first clear.'))
  }
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onClose() } },
    h('div', { class: 'modal monarchs', role: 'dialog', 'aria-label': 'Choose your Monarch' },
      h('div', { class: 'tut-head' }, h('h2', { class: 'modal-title' }, 'Who rules'),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: onClose, tip: () => 'Keep your choice. (Esc)' }, icon('close', 22))),
      h('div', { class: 'monarch-cards', role: 'radiogroup' }, MONARCH_LIST.map(card))))
  el.key = (e) => { if (e.key === 'Escape' || e.key === 'Enter') onClose() }
  return el
}

// Sound and How to play in the top corner of a screen with no top bar (the title, the end): a finger has no M
// or H key.
function cornerButtons (onHelp) {
  return h('div', { class: 'corner-btns' }, musicButton(), muteButton(), helpButton(onHelp))
}
const helpButton = (onHelp) => h('button', { class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play (H)' }, icon('help', 22))

// ── shared chrome ────────────────────────────────────────────────────────────────────────────────

// The run as a row of icons (the Slay the Spire bar): the floors, the purse, the Monarch's HP, your souls, a
// tile per relic held in its tier's colour, a count on it for copies (hover one for what it does), then sound and
// help. The bar is rebuilt on every change: `drawn` keeps what it last showed, so a changed purse rolls to its new
// value and flashes, and a relic just taken (a copy more too) pops in.
const drawn = { run: null, essence: 0, hp: 0, souls: 0, held: {} }
// The copies held of each relic: { id: n }, in the order first taken.
const heldCounts = (s) => Object.fromEntries([...new Set(s.relics)].map((id) => [id, relicCount(s, id)]))

// `tabs`: the run's tabs (runScreen), folded into the bar as compact icons, so the board keeps the screen's width.
function topbar (run, onHelp, tabs = null) {
  const s = run.state
  const fresh = drawn.run !== run
  const n = souls(s.party).length
  if (fresh) Object.assign(drawn, { run, essence: s.essence, hp: monarchOf(s).hp, souls: n, held: heldCounts(s) })
  const purse = h('b', null, Math.round(drawn.essence))
  const chip = h('span', { class: 'chip-stat essence', tip: () => essenceTip(run) }, icon('soul', 20), purse)
  if (drawn.purse) cancelAnimationFrame(drawn.purse.rolling)
  drawn.purse = purse
  roll(purse, drawn.essence, s.essence, chip, (v) => { drawn.essence = v })
  // Your souls, the field's and the ossuary's, of the most you may hold.
  const count = h('b', null, Math.round(drawn.souls))
  const kept = h('span', {
    class: 'chip-stat souls',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Souls ${n}/${rosterCap(run)}`),
      h('p', null, ossuaryCount(run)))
  }, icon('hood', 20), count, h('span', { class: 'of' }, `/${rosterCap(run)}`))
  if (drawn.count) cancelAnimationFrame(drawn.count.rolling)
  drawn.count = count
  roll(count, drawn.souls, n, kept, (v) => { drawn.souls = v })
  const held = drawn.held
  const counts = drawn.held = heldCounts(s)
  // A relic's tile wears its own glyph in its tier's colour; the Legendaries share one, told apart by a letter pair.
  // A copy more shows as ×N in the top corner.
  const tile = (id) => {
    const r = relicDef(id)
    const n = counts[id]
    return h('span', {
      class: `trinket rt-${r.tier}` + (r.on ? ' trig' : '') + ((held[id] ?? 0) < n ? ' new' : ''), 'data-id': id, tabindex: '0',
      'aria-label': n > 1 ? `${r.name} ×${n}` : r.name, tip: () => relicTip(id, run)
    }, icon(relicIcon(id), 22), r.tier === 'legendary' && h('i', { class: 'badge' }, letterPair(r.name)), n > 1 && h('i', { class: 'count' }, `×${n}`))
  }
  const t = Object.keys(counts).length
  return h('header', { class: 'topbar' },
    floorPips(s),
    h('div', { class: 'chips' }, chip, monarchChip(run), kept),
    tabs,
    // A column a tile, all but the last free to narrow (feel.css .trinkets).
    t > 0 && h('div', { class: 'trinkets', style: `grid-template-columns: ${t > 1 ? `repeat(${t - 1}, minmax(0, var(--tap))) ` : ''}var(--tap)` },
      Object.keys(counts).map(tile)),
    h('div', { class: 'top-btns' }, musicButton(), muteButton(), helpButton(onHelp)))
}

// Your souls by where they are: "4/5 on the field, 2 in the ossuary (1 fallen)".
function ossuaryCount (run) {
  const all = souls(run.state.party)
  const kept = inOssuary(all)
  const fallen = kept.filter((u) => u.hp <= 0).length
  return `${fielded(all).length}/${fieldCap(run)} on the field, ${kept.length} in the ossuary${fallen ? ` (${fallen} fallen)` : ''}.`
}

// The purse's tooltip: the essence held, earned and spent this run, the floor's prices against floor 1's (run.js
// priceScale: the floor's, and the ascension's), the cheapest tier a kind you hold may take now, and what a slain foe
// pays.
function essenceTip (run) {
  const s = run.state
  const scale = priceScale(s)
  const next = heldKinds(s).flatMap((id) => [0, 1].filter((t) => canAdvance(s, id, t)).map((t) => ({ id, t, cost: tierCost(run, id, t) })))
    .sort((a, b) => a.cost - b.cost)[0]
  return h('div', { class: 'syn-tip' }, h('b', null, `${s.essence} essence`),
    h('p', null, `${s.stats.essence} earned, ${s.stats.spent} spent this run · ${scale === 1 ? 'floor 1 prices' : `prices ×${+scale.toFixed(2)} floor 1's`}` +
      `${ascensionOf(s).price !== 1 ? `, ascension ${s.ascension}'s ×${+ascensionOf(s).price.toFixed(2)} among them` : ''}.`),
    next && h('p', null, `Cheapest tier now: ${unitDef(next.id).name}, ${tracksOf(next.id)[next.t].name} ${ROMAN[s.kinds[next.id].tracks[next.t]]}, for ${next.cost}${next.cost > s.essence ? ` (${next.cost - s.essence} short)` : ''}.`),
    h('p', { class: 'dim' }, `A slain foe pays ${payPer(s.floor)} × its tier on this floor.`))
}

// A Legendary's tag, its words' initials ("Court of Bone" CB), small words skipped.
const letterPair = (name) => name.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('').slice(0, 2)

// Counts `el` from `from` to `to` (rounded as it goes), then flashes `host` (green for a gain, red for a
// loss); onStep sees every value drawn, so a re-render mid-roll carries on from where it got to. Reduced
// motion: it jumps, and still flashes.
function roll (el, from, to, host = el, onStep = null) {
  cancelAnimationFrame(el.rolling)
  if (from === to) { el.textContent = Math.round(to); onStep?.(to); return }
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!still) holdWidth(el, from, to)
  host.classList.remove('gain', 'spend')
  void host.offsetWidth
  host.classList.add(to > from ? 'gain' : 'spend')
  const ms = still ? 0 : Math.min(700, 260 + Math.abs(to - from) * 6)
  const t0 = performance.now()
  const step = (now) => {
    const f = ms ? Math.min(1, (now - t0) / ms) : 1
    const v = from + (to - from) * (1 - (1 - f) ** 3)
    el.textContent = Math.round(f >= 1 ? to : v)
    onStep?.(f >= 1 ? to : v)
    if (f < 1) el.rolling = requestAnimationFrame(step)
    else Object.assign(el.style, { minWidth: '', display: '', textAlign: '' })
  }
  el.rolling = requestAnimationFrame(step)
}

// The display face's digits are not all one width (Fredoka has no tabular figures), so while a number rolls its box
// is held as wide as that many of its widest digit, right-aligned, and the bar beside it never jitters; it lets go
// once the number lands.
function holdWidth (el, from, to) {
  const n = Math.max(String(Math.round(from)).length, String(Math.round(to)).length)
  const text = el.textContent
  Object.assign(el.style, { minWidth: '', display: 'inline-block', textAlign: 'right' })
  let w = 0
  for (let d = 0; d < 10; d++) { el.textContent = String(d).repeat(n); w = Math.max(w, el.offsetWidth) }
  el.textContent = text
  el.style.minWidth = `${w}px`
}

// The speaker: sound on or off (M), remembered between visits. It draws both icons; <html data-muted>
// (set by sfx) shows the one that holds.
function muteButton () {
  return h('button', {
    class: 'icon-btn mute-btn',
    'data-sfx': 'none',
    'aria-label': 'Sound on or off',
    onclick: () => { if (!sfx.toggle()) sfx.play('click') },
    tip: () => 'Sound on or off. (M)'
  }, icon('sound', 22), icon('mute', 22))
}

// The note: music on or off (music.js), remembered between visits, heard only while sound is on. Both icons drawn;
// <html data-music> shows the one that holds. Its volume is How to play's (soundControls).
function musicButton () {
  return h('button', {
    class: 'icon-btn music-btn',
    'data-sfx': 'none',
    'aria-label': 'Music on or off',
    onclick: () => { music.toggle(); sfx.play('click') },
    tip: () => music.on ? (sfx.muted ? 'Music on, but sound is off: the speaker brings both back.' : 'Music on or off. Its volume is in How to play.') : 'Music off: turn it on.'
  }, icon('music', 22), icon('nomusic', 22))
}

// The sound's settings, for How to play's foot: the effects and the music, each on or off, and the music's volume.
export function soundControls () {
  const toggle = (label, get, flip) => {
    const b = h('button', { class: 'small ghost snd-toggle', 'data-sfx': 'none', role: 'switch' })
    const shown = () => { b.setAttribute('aria-checked', get() ? 'true' : 'false'); b.textContent = `${label}: ${get() ? 'on' : 'off'}` }
    b.addEventListener('click', () => { flip(); shown(); sfx.play('click') })
    shown()
    return b
  }
  const vol = h('input', {
    type: 'range', min: '0', max: '100', step: '5', value: String(Math.round(music.volume * 100)), 'aria-label': 'Music volume',
    oninput: (e) => { music.volume = Number(e.target.value) / 100 }
  })
  return h('div', { class: 'snd-ctl' },
    toggle('Sound', () => !sfx.muted, () => sfx.toggle()),
    toggle('Music', () => music.on, () => music.toggle()),
    h('label', { class: 'snd-vol' }, 'Music volume', vol))
}

// The floors: a pip each down to the Sovereign's, lit as they are cleared; past it, in the deep, a deep pip
// and how far down the run has gone.
function floorPips (s) {
  const n = TUNING.run.floors
  const deep = depthOf(s.floor)
  // The tutorial's one room stands before floor 1 (run.js tutorialRun).
  if (s.tutorial) return h('div', { class: 'floors', tip: () => 'The threshold: the tutorial\'s one room, before floor 1. It is never saved; the run proper begins from the title.' }, h('span', null, 'The threshold'))
  // The run's ascension (redesign.md §4.6), beside the floor where it is above 0, and in the tip.
  const asc = s.ascension ?? 0
  const ascTip = asc > 0 && h('p', null, h('b', null, `Ascension ${asc}`), `: ${ascensionText(asc).short}.`)
  return h('div', {
    class: 'floors' + (deep ? ' deep' : ''),
    tip: () => deep
      ? h('div', { class: 'syn-tip' }, h('b', null, `Floor ${s.floor} · the deep, ${deep} floor${deep === 1 ? '' : 's'} below the Sovereign's`), h('p', null, 'The run is cleared: the Hollow Sovereign fell to you, and that stands.'),
        h('p', null, DEEP_TEXT.now(s.floor)), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall), ascTip)
      : h('div', { class: 'syn-tip' }, h('p', null, `Floor ${s.floor} of ${n}. Each floor ends in a boss, the one that answers what your army leans on most as the floor opens; floor ${n} ends with the Hollow Sovereign, and slaying it clears the run. Past it, you may descend into the deep.`), ascTip)
  },
  Array.from({ length: n }, (_, i) => h('span', { class: 'pip' + (i + 1 < s.floor ? ' done' : i + 1 === s.floor ? ' now' : '') })),
  deep > 0 && h('span', { class: 'pip deep now' }),
  h('span', null, `Floor ${s.floor}`, deep > 0 && h('span', { class: 'fl-deep' }, ` · deep ${deep}`), asc > 0 && h('span', { class: 'fl-asc' }, ` · A${asc}`)))
}

// The Monarch's HP, always in view: if it falls, the run ends. A wound or a heal since the bar was last drawn
// flashes it (see topbar's `drawn`).
function monarchChip (run) {
  const m = monarchOf(run.state)
  const low = m.hp / m.maxHp < 0.35
  const moved = drawn.run === run && drawn.hp !== m.hp ? (m.hp > drawn.hp ? ' gain' : ' spend') : ''
  if (drawn.run === run) drawn.hp = m.hp
  return h('span', {
    class: 'chip-stat monarch' + (low ? ' low' : '') + moved,
    tip: () => unitCard(m, {
      mods: partyMods(run, m),
      realm: realmOf(run),
      live: monarchHpText(run),
      notes: [MONARCH_TEXT.hp.rule(run)[0], run.state.monarch && `${MONARCHS[run.state.monarch].name}: ${MONARCHS[run.state.monarch].line}`]
    })
  }, icon('crown', 20), h('b', null, `${m.hp}/${m.maxHp}`))
}

// The Field's gestures, taught one at a time in a slim pill atop the panel (never over the board), on every frame,
// each until it has been done once (remembered in this browser): select, then place a soul, then fuse (in the Shop).
const done = (k) => prefs.get('did:' + k) === '1'
const learnt = (k) => { if (!done(k)) prefs.set('did:' + k, '1') }

// ── the run's screen: Field · Map · Shop · Codex ────────────────────────────────────────────────

// The run between battles, one screen with its four tabs folded into the top bar (DESIGN §4), one view at a time:
// the Field (the board, as large as the screen holds, and one slim panel beside it: the selected piece's card, the
// ossuary at its foot like a Bloons TD shop), the Map (the floor's rooms: scout them, and walk to the next; a battle
// room's battle starts as it is entered), the Shop (the floor's shelf of relics, and the fusions: shopView) and the
// Codex (the rules, the words, the foes met). The Map opens first. Each tab's tooltip leads with its counts (`now`).
const TABS = [
  { id: 'field', name: 'Field', ico: 'field', key: 'F', desc: 'The board: place your souls and read the roads.', now: ossuaryCount },
  { id: 'map', name: 'Map', ico: 'map', key: 'R', desc: 'The floor: scout its rooms.',
    now: (run) => { const n = availableNodes(run).length; return `Floor ${run.state.floor}: ${n} room${n === 1 ? '' : 's'} open to you next.` } },
  { id: 'shop', name: 'Shop', ico: 'shop', key: 'B', desc: 'Relics and fusions for essence, open between battles.', now: shopCount },
  { id: 'codex', name: 'Codex', ico: 'codex', key: 'C', desc: 'The rules, the words and the foes you have met.',
    now: () => { const b = bestiaryCount(); return `${b.met} of ${b.of} foe kinds met.` } }]

// The Shop's counts: the relics on the shelf the purse reaches, and the fusions ready (every part held) and affordable.
function shopCount (run) {
  const left = shopOffers(run).filter(Boolean)
  const reach = left.filter((o) => o.cost <= run.state.essence).length
  const ready = shelfFusions(run)
  const afford = ready.filter((x) => x.can).length
  return `${reach} of ${left.length} relic${left.length === 1 ? '' : 's'} within reach; ${ready.length} fusion${ready.length === 1 ? '' : 's'} ready, ${afford} affordable.`
}

// trail: node ids visited on this floor, in order (starts with the start node). onNode: walk to a room.
export function runScreen ({ run, act, trail, note = '', onNode, onHelp }) {
  const bar = h('div', { class: 'bar-slot' })
  const tabsEl = h('nav', { class: 'top-tabs', role: 'tablist', 'aria-label': 'Views' })
  const refresh = () => fill(bar, topbar(run, onHelp, tabsEl))
  const editor = fieldEditor({ run, act, onChange: refresh })
  refresh()

  const body = h('div', { class: 'run-body' })
  // The note (what just happened) floats over the foot of the view: a tap dismisses it, and it fades by itself.
  const toast = note && h('div', { class: 'note', role: 'status', onclick: (e) => e.currentTarget.remove() }, note)
  const reach = availableNodes(run)
  let tab = null
  const show = (id) => {
    if (tab === id) return
    if (tab && toast) toast.remove()
    tab = id
    hideTip()
    editor.release()
    fill(tabsEl, TABS.map((t) => h('button', {
      class: 'top-tab' + (t.id === tab ? ' on' : ''), role: 'tab', 'aria-selected': t.id === tab ? 'true' : 'false', 'data-tab': t.id,
      onclick: () => show(t.id), tip: () => h('div', { class: 'syn-tip' }, h('b', null, t.name), say(` (${t.key})`, ''), h('p', null, t.now(run)), h('p', { class: 'dim' }, t.desc))
    }, icon(t.ico, 22), h('span', { class: 'top-tab-name' }, t.name))))
    fill(body, id === 'field' ? editor.el
      : id === 'map' ? mapView({ run, trail, onNode })
        : id === 'shop' ? shopView({ run, act, onChange: refresh }).el
          : h('section', { class: 'panel codex-panel' }, codexView(run)))
    if (id === 'field') editor.shown()
  }
  show('map')
  const el = h('div', { class: 'screen fit run-screen' }, bar, body, toast)
  return {
    el,
    key (e) {
      const n = reach[Number(e.key) - 1]
      if (n) { editor.release(); onNode(n.id) } else if (e.key === 'f' || e.key === 'F') show('field')
      else if (e.key === 'r' || e.key === 'R') show('map')
      else if (e.key === 'b' || e.key === 'B') show('shop')
      else if (e.key === 'c' || e.key === 'C') show('codex')
      else if (tab === 'field') editor.key(e)
    }
  }
}

export const NODE = Object.fromEntries(Object.entries(ROOM).map(([k, v]) => [k, { name: k === 'boss' ? 'Boss' : v.name }]))

// ── the map ──────────────────────────────────────────────────────────────────────────────────────

// The whole floor at once, left to right: its ranks across (the start on the left, the elite or the boss on the
// right), its lanes down. Places are in % of the floor's box (style.css .dag), so the floor fits any frame.
const pos = (n) => ({ x: n.rank / (RANKS - 1) * 100, y: n.lane / (WIDTH - 1) * 100 })

// A mouse's click enters a glowing room. By touch a tap scouts, since entering is for good: a glowing room's first
// tap chooses it, its tooltip pinned with Enter ▸, and a second tap on it (or Enter ▸) enters; a tap anywhere else
// lets it go.
function mapView ({ run, trail, onNode }) {
  const s = run.state
  const reach = availableNodes(run)
  const reachIds = new Set(reach.map((n) => n.id))
  const walked = new Set(trail.slice(1).map((id, i) => `${trail[i]}>${id}`))
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('preserveAspectRatio', 'none')
  for (const n of s.map.nodes) {
    for (const id of n.next) {
      const a = pos(n)
      const b = pos(s.map.nodes.find((x) => x.id === id))
      const path = document.createElementNS(svgNS, 'path')
      const mx = (a.x + b.x) / 2
      path.setAttribute('d', `M${a.x} ${a.y} C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`)
      const cls = walked.has(`${n.id}>${id}`) ? 'walked' : n.id === s.at && reachIds.has(id) ? 'open' : ''
      path.setAttribute('class', 'edge ' + cls)
      svg.append(path)
    }
  }
  let chosen = null
  const scout = (el, n, ok) => {
    chosen = ok ? el : null
    el.classList.toggle('chosen', ok)
    pinTip(el, () => [roomTip(run, n, { reachable: ok, enter: ok }),
      ok && h('button', { class: 'primary small tip-act', onclick: () => onNode(n.id) }, 'Enter ▸')], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (chosen === el) chosen = null }
    })
  }
  const nodes = s.map.nodes.map((n) => {
    const p = pos(n)
    const ok = reachIds.has(n.id)
    const key = ok ? reach.findIndex((x) => x.id === n.id) + 1 : null
    return h('button', {
      class: `node t-${n.type}` + (ok ? ' reach' : '') + (trail.includes(n.id) ? ' visited' : '') + (n.id === s.at ? ' here' : '') + (!ok && !trail.includes(n.id) ? ' far' : ''),
      style: `left:${p.x}%;top:${p.y}%`,
      'aria-disabled': ok ? null : 'true',
      'aria-label': NODE[n.type].name,
      tip: () => roomTip(run, n, { reachable: ok }),
      onclick: (e) => {
        if (!touchy()) { if (ok) onNode(n.id); return }
        if (ok && chosen === e.currentTarget) return onNode(n.id)
        scout(e.currentTarget, n, ok)
      }
    }, h('span', { class: 'medal' }, icon(n.type, 24)), h('span', { class: 'node-name' }, NODE[n.type].name), key && h('kbd', null, key))
  })
  return h('section', { class: 'panel mapcol', 'aria-label': 'The floor' },
    h('div', { class: 'map-head' }, h('h2', null, s.tutorial ? 'The threshold' : `Floor ${s.floor}`),
      h('span', { class: 'dim' }, say('Click a glowing room to enter it (or its number); hover any to scout it.', 'Tap a glowing room twice to enter it; tap any to scout it.'))),
    h('div', { class: 'dag-wrap' }, h('div', { class: 'dag' }, svg, nodes)))
}

// ── the Field ────────────────────────────────────────────────────────────────────────────────────

// The camp and the ossuary under it, the board's plan laid over it (board.js), and beside them the panel of
// the selected piece: a soul's, or with nothing selected the Monarch's. onChange runs after every action it sends.
//
// The gestures (DESIGN §4), the same by mouse and by touch, none needing hover, Shift or a key:
//   tap a piece            select it (its panel); tap it again, or empty ground, and the Monarch's
//                          panel is back (Escape too)
//   drag a piece           move it onto open ground (a 2×2 shows its four cells under the finger, red where
//                          they do not fit), onto another piece (they swap: a footprint over one piece, never
//                          two, nor the Monarch's seat), or onto the bench to keep it in the ossuary; the
//                          Monarch never moves
//   drag a soul from the bench  place it; tap it, then an open camp tile, places it too
//   tap a relic in the Relics strip, then a soul (on the board, in the ossuary, or its panel's slot)
//                          give it (redesign.md §2.15); a soul holding one swaps; its panel's Take back returns it
//   long press (touch)     the card of whatever is there, pinned

function fieldEditor ({ run, act, onChange = null }) {
  const s = run.state
  const el = h('div', { class: 'retinue' })
  // The selection: { uid } a soul of yours or the Monarch (on the field or in the ossuary), or null: the Monarch's
  // panel.
  let sel = null
  let error = ''
  // A synergy whose chip was pressed: its pieces glow bright (synergyTracker's focus), until pressed again.
  let focusSyn = null
  // A piece relic tapped in the Relics strip, waiting for the soul to give it to (null: none).
  let giving = null
  const stage = h('div', { class: 'board-stage', 'aria-label': 'The board. Tap a piece to select it; drag a piece to move it. Keys: the arrows move a cursor, Enter taps, Escape lets go.' })
  const hintEl = h('div', { class: 'board-hint', role: 'status' })
  const stageWrap = h('div', { class: 'stage-wrap' }, stage)
  const benchEl = h('div', { class: 'bench-strip' })
  const relicEl = h('div', { class: 'relic-strip' })
  const panelBody = h('div', { class: 'tab-body' })
  const errEl = h('p', { class: 'warn panel-err' })
  const panelEl = h('div', { class: 'tray' }, errEl, panelBody)
  const sideEl = h('div', { class: 'side-col' }, hintEl, panelEl, benchEl, relicEl)
  el.append(stageWrap, sideEl)
  let shown = ''
  // The board's tooltips, by tile; the tile under the pointer; a press, which turns into a drag past a few pixels;
  // the drag (a piece moved); a bench soul's click to swallow after it was dragged.
  let tips = new Map()
  let hover = null
  let press = null
  let drag = null
  let swallow = false
  let keeping = false

  const soulOf = (uid) => s.party.find((u) => u.uid === uid)
  const selected = () => sel?.uid != null ? soulOf(sel.uid) ?? null : null
  // A fielded piece's board tiles (its footprint: four for a 2×2), and the piece whose footprint covers tile t.
  const cellsOf = (u) => footprint(deployTile('party', u.slot), sizeOf(u)) ?? [deployTile('party', u.slot)]
  const pieceAt = (t) => typeof t === 'number' ? fielded(s.party).find((u) => cellsOf(u).includes(t)) ?? null : null
  // A fielded piece's camp cells (its footprint's slots); the fielded piece but `except` whose footprint covers camp
  // cell `slot`; and the camp cells the fielded pieces but `except` hold.
  const slotsOf = (x) => footprintSlots(x.slot, sizeOf(x)) ?? [x.slot]
  const coverAt = (slot, except = null) => fielded(s.party).find((x) => x !== except && slotsOf(x).includes(slot)) ?? null
  const heldBut = (...except) => new Set(fielded(s.party).filter((x) => !except.includes(x)).flatMap(slotsOf))
  // The camp slot of a board tile, or null past the camp.
  const slotOfTile = (t) => typeof t === 'number' && tileY(t) < CAMP_ROWS ? slotAt(CAMP_ROWS - 1 - tileY(t), tileX(t)) : null
  const full = () => fielded(souls(s.party)).length >= fieldCap(run)
  const fullText = (u) => `The field is full (${fieldCap(run)} pieces): drop ${unitDef(u.id).name} onto one of yours to swap them, put one in the ossuary first, or take a Command relic.`

  // Every action keeps the selection but a move's: a purchase leaves it where it is.
  function send (action) {
    error = act(action) ?? ''
    render()
    onChange?.()
    return !error
  }
  function refuse (why) {
    error = why
    sfx.play('poor')
    render()
  }
  // By touch a purchase (a tier, a fusion) is read before it is made, as a Shop's card is (redesign.md §4: a second
  // tap commits): the first tap pins its text with `label` under it, and a second tap on it, or that button, makes
  // it. A click makes it at once: its hover read it. `ok()`: whether the button is offered (it can be paid for).
  let reading = null
  function twice (e, tip, label, ok, go) {
    const el = e.currentTarget
    if (!touchy() || reading === el) { reading = null; return go(e) }
    reading = el
    el.classList.add('chosen')
    pinTip(el, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); reading = null; go(e) } }, label)], {
      keep: true,
      onHide: () => { el.classList.remove('chosen'); if (reading === el) reading = null }
    })
  }
  function select (next) {
    sel = next
    error = ''
    if (next) learnt('select')
    render()
  }

  // The gesture to learn next, if one is left (the hints: see learnt), in a few words for the pill atop the panel; while
  // a relic waits to be given, what to tap.
  function hint () {
    const p = selected()
    const tap = say('Click', 'Tap')
    if (giving) return [h('b', null, tap), ' a soul to give it ', h('b', { class: `c-${relicDef(giving).tier}` }, relicDef(giving).name), ' · again to cancel']
    if (!done('select')) return [h('b', null, tap), ' a piece to select it · ', h('b', null, 'drag'), ' one to move it']
    if (!done('place') && inOssuary(souls(s.party)).some((u) => u.hp > 0) && !full()) return [h('b', null, 'Drag'), ' a soul from the ossuary onto the camp to field it']
    const ready = !done('fuse') && FUSION_LIST.find((f) => canFuse(run, f.id))
    if (ready) return [h('b', null, ready.name), ' can be made: open the ', h('b', null, 'Shop'), ' tab, then ', h('b', null, 'Fuse')]
    return null
  }

  // ── the picture ──

  // The selected soul's reach round its footprint, as its card tells it (codex.js reachText, unit.js reachOf: the
  // furthest its blows reach, its tiers' too); the battle draws the same round a selected piece. None for the
  // Monarch, which never strikes, for a soul in the ossuary, or while a piece is moved.
  function reachNow (picked) {
    const r = picked && !drag && onField(picked) && !isMonarch(picked) && picked.hp > 0 ? reachOf(picked) : 0
    return r > 0 ? { centre: deployTile('party', picked.slot), size: sizeOf(picked), r } : null
  }

  // Arise's reach (redesign.md §2.15), round the soul holding an Arise relic where it starts the battle: the selected
  // one if it holds one, else the first fielded holder. Null with none fielded.
  function domainNow (picked) {
    const holder = [picked, ...fielded(souls(s.party))].find((u) => u && onField(u) && u.hp > 0 && ariseFor(s, u))
    return holder ? { centre: deployTile('party', holder.slot), size: sizeOf(holder), r: ariseFor(s, holder).domain } : null
  }

  function render () {
    // A Release armed on one soul is let go of once another is selected.
    if (arming != null && selected()?.uid !== arming) arming = null
    const fieldNow = fielded(s.party)
    const m = monarchOf(s)
    const mTile = deployTile('party', m.slot)
    const walls = wallTiles(s.camp)
    const groups = synergyGroups(souls(standing(run)), alsoOf)
    const picked = selected()
    if (sel && !picked) sel = null
    // Who glows bright: the selected piece's partners in every synergy it counts toward, or a pressed chip's.
    const lit = new Set(groups.filter((g) => (focusSyn ? g.key === focusSyn : picked && g.uids.has(picked.uid))).flatMap((g) => [...g.uids]))
    const units = []
    tips = new Map()
    const roads = field({ root: mTile, walls })
    // A soul of a kind that flies hovers, as in battle.
    for (const u of fieldNow) {
      const tile = deployTile('party', u.slot)
      units.push({
        key: `s${u.uid}`, id: u.id, tile, size: sizeOf(u), side: 'party', hp: u.hp, maxHp: u.maxHp, lvl: u.lvl, tracks: u.tracks, relics: u.relics ?? [], monarch: isMonarch(u),
        fallen: u.hp <= 0, sel: sel?.uid === u.uid, glow: groups.filter((g) => g.uids.has(u.uid)).map((g) => g.colour), lit: lit.has(u.uid),
        offer: !!giving && canHold(s, giving, u), flies: !!unitDef(u.id).flies
      })
      for (const t of cellsOf(u)) tips.set(t, () => pieceTip(u))
    }
    // Empty ground: what it is, whether Arise reaches it (only while a holder stands on the field: without one it
    // does nothing, and is not drawn or told), and how far its road runs to the Monarch.
    const dom = domainNow(picked)
    for (let t = 0; t < LANES * DEPTH; t++) {
      if (tips.has(t)) continue
      const wall = walls.includes(t)
      const d = roads.dist[t]
      tips.set(t, () => h('div', { class: 'syn-tip tile-tip' },
        h('div', null, h('b', null, wall ? 'Wall' : sentence(tileText(t))), dom && [' · ', distanceBetween(dom.centre, dom.size, t, 1) <= dom.r ? 'within Arise\'s reach' : h('span', { class: 'dim' }, 'beyond Arise\'s reach')]),
        h('div', { class: 'dim' }, wall ? 'It blocks walking, not shots: the roads bend round it.'
          : Number.isFinite(d) ? `Its road runs ${d} step${d === 1 ? '' : 's'} to the Monarch.` : 'No road runs from here.')))
    }
    const moving = drag ? soulOf(drag.uid) : null
    const picture = {
      walls, units, domain: dom, reach: reachNow(picked), roads: roads.arrow, seat: mTile,
      drop: dropTiles(moving), dropSize: moving ? sizeOf(moving) : 1, selKey: picked && onField(picked) ? `s${picked.uid}` : null
    }
    stage.className = 'board-stage' + (drag ? ' dragging' : '') + (keyed ? ' kb' : '')
    const teach = hint()
    fill(hintEl, teach)
    hintEl.hidden = !teach || !!drag
    fill(benchEl, benchStrip())
    fill(relicEl, relicStrip())
    relicEl.hidden = !unheld(s).length
    keeping = document.activeElement === stage
    if (keeping && stage.isConnected) stage.focus({ preventScroll: true })
    keeping = false
    errEl.textContent = error
    errEl.hidden = !error
    const now = picked ? `s${picked.uid}` : 'monarch'
    fill(panelBody, picked && !isMonarch(picked) ? soulPanel(picked) : monarchPanel())
    if (now !== shown) panelBody.scrollTop = 0
    shown = now
    board.show(stage, picture)
    if (hover != null && !drag && tips.has(hover)) tileTip(hover)
  }

  // ── the bench ──

  // Under the board: your souls in the ossuary, each a cell to drag onto the camp (or tap, then tap an open
  // tile), a fallen one marked so where its HP bar would be (it waits for an altar); a piece dropped on the strip
  // goes to the ossuary. How many it keeps, and the field's, at its head.
  function benchStrip () {
    const bench = inOssuary(s.party)
    const moving = drag ? soulOf(drag.uid) : null
    const target = moving && onField(moving) && !isMonarch(moving)
    return [
      h('div', {
        class: 'bench-label',
        tip: () => {
          const kept = inOssuary(souls(s.party))
          const fallen = kept.filter((u) => u.hp <= 0).map((u) => unitDef(u.id).name)
          return h('div', { class: 'syn-tip' },
            h('b', null, `Ossuary · ${kept.length ? `${kept.length} kept: ${kept.length - fallen.length} ready${fallen.length ? `, ${fallen.length} fallen (${tally(fallen)})` : ''}` : 'empty'}`),
            h('p', null, `Field ${fielded(souls(s.party)).length}/${fieldCap(run)}, ${fieldRule(run)} · souls ${souls(s.party).length}/${rosterCap(run)}.`),
            h('p', { class: 'dim' }, 'Drag a soul from here onto the camp, or a piece from the camp onto here.'))
        }
      }, h('b', null, 'Ossuary'), h('span', { class: 'dim' }, `${bench.length ? `${bench.length} kept` : 'empty'} · field ${fielded(souls(s.party)).length}/${fieldCap(run)}`)),
      (bench.length || target) && h('div', { class: 'bench' + (target ? ' target' : '') + (drag?.target?.bench && drag.target.ok ? ' over' : '') },
        bench.length
          ? bench.map((u) => h('button', {
            class: 'cell has' + (sel?.uid === u.uid ? ' sel' : '') + (u.hp <= 0 ? ' fallen' : '') + (giving && canHold(s, giving, u) ? ' gift' : ''),
            'data-uid': u.uid,
            onpointerdown: (e) => pressBench(e, u),
            onclick: () => { if (swallow) { swallow = false; return } if (giving) return give(u); select(sel?.uid === u.uid ? null : { uid: u.uid }) },
            tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run, live: benchLead(u), notes: [u.hp > 0 && !full() && 'Drag it onto an open tile of the camp to field it.'] })
          }, portrait(u.id, 46, u.hp <= 0), u.maxHp && u.hp > 0 && hpBar(u.hp, u.maxHp), relicMark(u)))
          : h('span', { class: 'dim empty-bench' }, 'Drop it here to keep it in the ossuary.'))]
  }

  // A soul in the ossuary, its card's lead: whether the field has room for it, or that it lies fallen.
  function benchLead (u) {
    const f = `${fielded(souls(s.party)).length}/${fieldCap(run)}`
    return u.hp <= 0 ? `Fallen: an altar raises it at ${Math.round(TUNING.run.altarRevive * 100)}% HP`
      : full() ? `In the ossuary · field ${f}, full: drop it on a piece to swap` : `In the ossuary · field ${f}: room for it`
  }

  // ── relics ──

  // Beside the ossuary (redesign.md §2.15): the piece relics bought and held by no soul, a button each (a copy more a
  // ×N). A tap readies one to give, and the souls that may take it light up; a soul tapped then (on the board, in the
  // ossuary, or its panel's slot) takes it. Hidden while none waits.
  function relicStrip () {
    return relicChips(run, giving, (id) => { giving = giving === id ? null : id; error = ''; sfx.play('select'); render() })
  }

  // The relic readied (giving) goes to soul `u`, swapping out what it holds; refused in words where it cannot.
  function give (u, relic = giving) {
    if (!relic) return
    if (!u || isMonarch(u)) return refuse('The Monarch holds no relic: give it to a soul.')
    if (!canHold(s, relic, u)) return refuse(`${unitDef(u.id).name} already holds ${relicDef(relic).name}.`)
    giving = null
    if (send({ type: 'hold', relic, uid: u.uid })) sfx.play('buy')
  }

  // A soul's relic slot in its panel: the relic it holds (its rule on hover) and Take back; and the unheld piece
  // relics, each a button that gives it here (or swaps), the one readied in the strip lit.
  function relicSection (u) {
    const held = u.relics ?? []
    const full = held.length >= TUNING.relic.perPiece
    const ids = [...new Set(unheld(s))].filter((id) => canHold(s, id, u))
    return h('div', { class: 'uc-relic' },
      h('div', { class: 'uc-sec' }, kw('relic', 'Relic'), h('span', { class: 'dim' }, ` · ${held.length}/${TUNING.relic.perPiece}`)),
      h('div', { class: 'rs-row' },
        held.map((id) => [h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id, run) }, icon(relicIcon(id), 18), relicDef(id).name),
          h('button', { class: 'ghost small', onclick: () => send({ type: 'unhold', uid: u.uid, relic: id }), tip: () => `Take ${relicDef(id).name} back: it waits unheld, to give again.` }, 'Take back')]),
        !full && h('span', { class: 'rs-empty dim' }, ids.length ? '◇ Empty: give it one' : '◇ Empty: buy a piece relic in the Shop')),
      ids.length > 0 && h('div', { class: 'rs-give' }, ids.map((id) => h('button', {
        class: `give-relic small rt-${relicDef(id).tier}` + (giving === id ? ' on' : ''),
        onclick: () => give(u, id),
        tip: () => h('div', null, relicTip(id, run), h('p', { class: 'dim' }, full ? `Swap it for ${held.map((x) => relicDef(x).name).join(', ')}, which waits unheld.` : `Give it to ${unitDef(u.id).name}.`))
      }, icon(relicIcon(id), 16), full ? `Swap: ${relicDef(id).name}` : relicDef(id).name))))
  }

  // ── the panels ──

  // A refused press shakes its button.
  function shake (e) {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  // A piece's head: its picture (its full card on hover), name, level, kin and role, and its stats as it fights
  // now, its HP at them.
  function pieceHead (u, mods) {
    const d = unitDef(u.id)
    const st = statsOf(u, mods)
    const [hp, maxHp] = hpAt(u, st)
    // Each stat's hover breaks it down (codex.js statTip): its kind's at its level, each tier and relic, what it means.
    const stat = (ico, v) => h('span', { class: 'uc-stat s-' + ico, tip: () => statTip(run, u, ico) }, icon(ico, 18), h('b', null, v))
    return [h('div', { class: 'uc-head' },
      h('div', { class: 'uc-art', tip: () => unitCard(u, { mods, realm: realmOf(run), run }) }, portrait(u.id, 56, u.hp <= 0), relicMark(u)),
      h('div', { class: 'uc-id' },
        h('div', { class: 'uc-name' }, d.name),
        h('div', { class: 'uc-sub dim' }, `Lv ${u.lvl} · ${d.kin ? `${KIN[d.kin].name} ` : ''}${ROLES[d.role].name}`))),
    h('div', { class: 'uc-stats' },
      stat('hp', hp < maxHp ? `${hp}/${maxHp}` : maxHp),
      stat('atk', Math.round(st.atk)), stat('def', Math.round(st.def)), stat('move', Math.round(st.move))),
    h('div', { class: 'uc-reach', tip: () => reachRule(u) }, icon('reach', 18), h('span', null, reachText(u)))]
  }

  // Its abilities and its aura, each a line (the card's).
  const abilities = (u, st) => h('div', { class: 'uc-abs' }, abilityBlocks(u, st, realmOf(run)), auraBlock(u))

  // A soul's panel: its head; its relic slot; the summons its kind's tiers bring it each battle, if any; where it
  // stands (how to field it); its kind (its level, read from its tiers, and the two tracks); its abilities (Arise
  // among them while it holds an Arise relic); to the ossuary. Its fusions are the Shop's (shopView): one place to buy.
  function soulPanel (u) {
    const mods = partyMods(run, u)
    const on = onField(u)
    return h('div', { class: 'uc' },
      pieceHead(u, mods),
      relicSection(u),
      summonsOf(u) > 0 && h('p', { class: 'uc-note uc-summons' }, summonText(u, statsOf(u, mods), mods)),
      !on && h('p', { class: 'dim uc-note' }, u.hp <= 0 ? 'Fallen, in the ossuary: it cannot be fielded until an altar raises it.'
        : full() ? fullText(u) : say('In the ossuary. Drag it onto an open tile of the camp, or click one.', 'In the ossuary. Drag it onto an open tile of the camp, or tap one.')),
      kindPanel(u.id),
      h('div', { class: 'uc-sec' }, 'Abilities'),
      abilities(u, statsOf(u, mods)),
      h('div', { class: 'uc-acts' },
        on && h('button', { class: 'ghost small', onclick: () => place(u, OSSUARY), tip: () => `Keep ${unitDef(u.id).name} out of battle, in the ossuary.` }, icon('bone', 18), 'To the ossuary'),
        releaseButton(u)))
  }

  // Releasing a soul for good, for a share of its recruit price back (run.js releaseRefund): a duplicate is a choice of
  // field, fuse or sell. Never the last soul standing (run.js releasable). It cannot be undone, so the first press
  // only arms it and the second, on the same soul, releases.
  let arming = null
  function releaseButton (u) {
    const all = souls(s.party)
    if (all.length < 2 || !all.some((x) => x !== u && x.hp > 0)) return null
    const armed = arming === u.uid
    return h('button', {
      class: armed ? 'danger small' : 'ghost small',
      onclick: () => {
        if (!armed) { arming = u.uid; return render() }
        arming = null
        if (sel?.uid === u.uid) sel = null
        send({ type: 'release', uid: u.uid })
      },
      tip: () => `Release ${unitDef(u.id).name} forever, for ${releaseRefund(run, u)} essence back (${Math.round(TUNING.essence.refund * 100)}% of what recruiting it would cost now). Press twice: it can't be undone.`
    }, icon('release', 16), armed ? 'Release for good' : 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`))
  }

  // A kind's panel (DESIGN §2.6), the Bloons TD 6 way: its two tracks, each a row of tiers I–IV lit up to the one
  // held, the next priced at the row's end with what it does. Either track may go to II; once one passes II the
  // other stops there (the crosspath rule), its tiers past II locked. Every soul of the kind holds what is bought.
  // Its level is no buy: a read-out of its tiers (run.js levelOf), rising with each.
  function kindPanel (id) {
    const k = s.kinds[id]
    if (!k) return null
    const name = unitDef(id).name
    const held = s.party.filter((x) => x.id === id)
    const tracks = tracksOf(id)
    const lvl = kindLevel(s, id)
    const raw = levelOf({ tracks: k.tracks })
    // The level one tier more gives (either track's: a tier is a tier), and the words for it.
    const up = levelOf({ ...k, tracks: [k.tracks[0] + 1, k.tracks[1]] })
    const rise = up > lvl ? `Level ${lvl} → ${up}.` : `Level stays ${lvl}.`
    const row = (tr, t) => {
      const have = k.tracks[t]
      const can = canAdvance(s, id, t)
      const blocked = !can && have < 4
      const cost = can ? tierCost(run, id, t) : 0
      const next = tr.tiers[have]
      const other = tracks[1 - t]
      const lockText = `Locked: ${other.name} has passed II, so ${tr.name} stops at II.`
      const node = (tier, i) => {
        const lock = i >= have && !canTrack(k.tracks.map((v, j) => (j === t ? i : v)), t)
        const state = i < have ? 'own' : i === have && can ? (s.essence < cost ? 'next poor' : 'next') : lock ? 'lock' : 'later'
        const tip = () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${ROMAN[i]}: `), tier.desc),
          i < have ? null : lock ? h('p', { class: 'warn' }, lockText) : i > have ? h('p', { class: 'dim' }, `After ${ROMAN[i - 1]}.`)
            : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}. ${rise}`) : h('p', { class: 'dim' }, `${cost} essence, for every ${name}. ${rise}`))
        const press = (e) => { if (i === have && can) return buyTier(e, id, t, cost); if (i >= have) { sfx.play('poor'); shake(e) } }
        return h('button', {
          class: `tnode ${state}` + (tier.size === 2 ? ' colossus' : ''), 'aria-label': `${tr.name} ${ROMAN[i]}`, 'aria-disabled': i === have && can && s.essence >= cost ? null : 'true',
          onclick: (e) => (i < have ? null : twice(e, tip, `Buy ${ROMAN[i]} ▸`, () => i === have && can && s.essence >= cost, press)),
          tip
        }, h('span', { class: 'tnum' }, ROMAN[i]), tier.size === 2 && h('span', { class: 'tbadge', 'aria-label': '2×2' }, icon('big', 14)))
      }
      return h('div', { class: 'track' + (have ? ' held' : '') + (t ? ' second' : '') },
        h('div', {
          class: 'track-head',
          tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${tr.name} ${have}/${tr.tiers.length}`), ' ', tr.desc,
            h('p', { class: blocked ? 'warn' : 'dim' }, have >= tr.tiers.length ? 'Complete.' : blocked ? lockText
              : `Next: ${ROMAN[have]} for ${cost}${s.essence < cost ? `; you have ${s.essence}` : ''}. ${rise}`))
        }, h('b', null, tr.name), h('span', { class: 'track-desc dim' }, tr.desc)),
        h('div', { class: 'nodes' }, tr.tiers.map((tier, i) => [i > 0 && h('span', { class: 'tlink' + (i < have ? ' on' : '') }), node(tier, i)]),
          can && h('span', { class: 'tprice' + (s.essence < cost ? ' poor' : '') }, icon('soul', 16), cost)),
        h('div', { class: 'track-next' + (blocked ? ' warn' : '') }, have >= 4 ? 'Complete.' : blocked ? lockText : [h('b', null, `${ROMAN[have]} `), next.desc]))
    }
    return h('div', { class: 'uc-kind' },
      h('div', { class: 'uc-sec' }, `Every ${name}`, h('span', { class: 'dim' }, ` · ${held.length} held`)),
      h('div', {
        class: 'uc-level',
        tip: () => levelTip(id, lvl, up, raw < lvl)
      }, icon('levelup', 20), h('b', null, 'Level ', h('span', { class: 'num' }, lvl)), h('span', { class: 'dim' }, ' · rises with its tiers')),
      tracks.length === 2 && h('div', { class: 'tracks' }, tracks.map(row)))
  }
  // A kind's level, in its stats (unit.js baseStats): what it gives every soul of the kind now (`lvl`), and what the
  // next tier's level (`up`) adds to each; `fused`: the level is the kinds' fused into it, above its tiers'.
  function levelTip (id, lvl, up, fused) {
    const name = unitDef(id).name
    const [now, next] = [baseStats(id, lvl), baseStats(id, up)]
    const r = (st) => ({ hp: Math.round(st.hp), atk: Math.round(st.atk), def: Math.round(st.def) })
    const [a, b] = [r(now), r(next)]
    const gain = [['HP', 'hp'], ['ATK', 'atk'], ['DEF', 'def']].filter(([, k]) => b[k] !== a[k]).map(([w, k]) => `+${b[k] - a[k]} ${w}`).join(', ')
    const more = canAdvance(s, id, 0) || canAdvance(s, id, 1)
    return h('div', { class: 'syn-tip' },
      h('p', null, h('b', null, `Level ${lvl}: `), `HP ${a.hp}, ATK ${a.atk}, DEF ${a.def} for every ${name}, a recruit too${fused ? `; raised to ${lvl} by the kinds fused into it` : ''}.`),
      h('p', { class: 'dim' }, !more ? 'No tier left to buy.' : up > lvl ? `Next tier: Level ${up}${gain ? `, ${gain} each` : ''}.` : `Next tier: level stays ${lvl}.`))
  }
  // A Colossus tier sends each piece of the kind that no longer fits 2×2 where it stood to the ossuary: said.
  function buyTier (e, kind, track, cost) {
    if (s.essence < cost) { sfx.play('poor'); return shake(e) }
    const stood = fielded(s.party).filter((x) => x.id === kind).map((x) => x.uid)
    if (!send({ type: 'upgrade', kind, track })) return
    sfx.play('buy')
    const n = stood.filter((uid) => !onField(soulOf(uid))).length
    if (!n) return
    const name = unitDef(kind).name
    error = `${n === 1 ? `A ${name} no longer fits` : `${n} ${name} pieces no longer fit`} 2×2 where ${n === 1 ? 'it' : 'they'} stood: in the ossuary until you place ${n === 1 ? 'it' : 'them'} again.`
    render()
  }

  // The Monarch's panel, with nothing selected (DESIGN §4): a read-out, nothing to buy. Its HP and Command (the
  // relics give them: codex.js MONARCH_TEXT), and nothing else: it holds no relic, and Arise is a soul's skill. Then
  // your synergies, each chip a press that lights its pieces on the board.
  function monarchPanel () {
    const m = monarchOf(s)
    const stat = (k) => {
      const t = MONARCH_TEXT[k]
      return h('div', {
        class: 'mc-col',
        tip: () => h('div', { class: 'syn-tip' }, t.rule(run).filter(Boolean).map((line, i) => h('p', { class: i ? 'dim' : null }, i ? line : [h('b', null, `${t.name}: `), line])))
      },
      h('div', { class: 'mc-ico' }, icon(t.icon, 20)),
      h('div', { class: 'mc-name' }, t.name),
      h('div', { class: 'mc-val' }, t.value(run)),
      h('div', { class: 'mc-now' }, t.now(run)))
    }
    // Compact, so it shows whole in the slim panel: the head one line, the numbers two by two.
    return [h('div', { class: 'mc' },
      h('div', { class: 'uc-head' },
        h('div', { class: 'uc-art', tip: () => unitCard(m, { mods: partyMods(run, m), realm: realmOf(run), notes: ['Its seat is the camp\'s, marked by the crown: it never moves, and the roads run to it.'] }) }, portrait(m.id, 44, m.hp <= 0),
          h('span', { class: 'uc-ins crown' }, icon('crown', 14))),
        h('div', { class: 'uc-id' },
          h('div', { class: 'uc-name', tip: () => MONARCH_RULE }, 'The Monarch'),
          h('div', { class: 'mc-hp' }, hpBar(m.hp, m.maxHp), h('span', null, `${m.hp}/${m.maxHp}`)))),
      h('div', { class: 'mc-cols' }, ['hp', 'command'].map(stat))),
    h('div', { class: 'uc-sec' }, kw('synergy', 'Synergies'), h('span', { class: 'dim' }, say(' · click one to light its pieces', ' · tap one to light its pieces'))),
    synergyTracker(souls(standing(run)), alsoOf, { focus: focusSyn, onFocus: (key) => { focusSyn = focusSyn === key ? null : key; render() } }),
    h('div', { class: 'uc-sec' }, 'The board'),
    h('ul', { class: 'legend-list dim' },
      h('li', null, h('i', { class: 'lg-road' }), kw('road', 'Roads'), ': the arrows the foes walk to the Monarch.'),
      h('li', null, h('i', { class: 'lg-seat' }), 'The crown: the Monarch\'s seat, the camp\'s own. It never moves.'),
      domainNow(null) && h('li', null, h('i', { class: 'lg-dom' }), 'Arise\'s reach, round the soul holding it as the battle begins: the corpses it may raise.'))]
  }

  // ── tooltips ──

  // A fielded soul's card leads with where it starts the battle, its reach and Move, and the synergies it counts toward
  // ("Front row, lane 3 · Reach 2 · melee · Move 3 · Undead 4: Legion"), unless it holds Arise, whose reach leads.
  const pieceTip = (u) => {
    const at = !isMonarch(u) && [sentence(tileText(deployTile('party', u.slot)).replace(/^your camp, /, '')), reachText(u),
      ...synergyGroups(souls(standing(run)), alsoOf).filter((g) => g.uids.has(u.uid)).map((g) => g.name)].join(' · ')
    return unitCard(u, {
      mods: partyMods(run, u), realm: realmOf(run), run,
      live: isMonarch(u) ? 'If it falls, the run ends' : ariseFor(s, u) ? `Holds Arise: corpses within ${ariseFor(s, u).domain} tiles` : at,
      notes: [isMonarch(u) ? 'Its seat is the camp\'s, marked by the crown: it never moves.' : ariseFor(s, u) && at]
    })
  }
  function tileTip (t) {
    const r = t != null && tips.has(t) && board.rectOf(t)
    if (r) showTip(r, tips.get(t))
    else hideTip()
  }

  // ── acting ──

  // A soul to a camp slot (its footprint's anchor), or OSSUARY; the rules' refusals said in words before it is sent.
  function place (u, slot) {
    if (slot === u.slot) return render()
    if (isMonarch(u)) return refuse('The Monarch keeps the seat the camp gives it: it never moves.')
    if (slot !== OSSUARY && !canPlace(run, u, slot)) return refuse(placeRefusal(u, slot))
    const fresh = !onField(u) && slot !== OSSUARY
    if (sel?.uid === u.uid && fresh) sel = null
    if (send({ type: 'place', uid: u.uid, slot }) && fresh) learnt('place')
  }

  // Why piece u cannot stand anchored at camp cell `slot` (run.js canPlace said no), in words. Its footprint there
  // (a 2×2's four cells) is read whole: off the camp, the Monarch's seat, a wall, two pieces under it (a move swaps
  // with one piece, never two: run.js swapWith), the one under it with no room where u stands now, and only when
  // nothing would swap, a full field.
  function placeRefusal (u, slot) {
    const name = unitDef(u.id).name
    if (u.hp <= 0) return `${name} has fallen: it lies in the ossuary until an altar raises it.`
    const cells = footprintSlots(slot, sizeOf(u))
    if (!cells) return `${name} is 2×2: its four cells must all lie in the camp.`
    if (cells.some((c) => isMonarchCell(s.camp, c))) return 'The Monarch\'s seat is its own: nothing else stands on it.'
    if (cells.some((c) => isWall(s.camp, c))) return sizeOf(u) > 1 ? `A wall stands under ${name}'s four cells: a piece stands on open ground.` : 'A wall stands there: a piece stands on open ground.'
    const under = [...new Set(cells.map((c) => coverAt(c, u)).filter(Boolean))]
    if (under.length > 1) return `${name}'s footprint there covers ${under.length} pieces (${under.map((x) => unitDef(x.id).name).join(', ')}): a move swaps with one piece, never two.`
    const other = under[0]
    if (other && onField(u)) return `${unitDef(other.id).name} has no room where ${name} stands now, so they cannot swap.`
    if (!other && !onField(u) && full()) return fullText(u)
    return `${name} does not fit there.`
  }

  // The anchor a piece of u's size takes to cover camp cell `slot` (a tap on an open tile): the first of the
  // footprints over it that may be placed, else the cell itself.
  function anchorFor (u, slot) {
    if (sizeOf(u) === 1) return slot
    const [r, c] = [rowOf(slot), slot % COLS]
    const ways = [[r, c], [r, c - 1], [r + 1, c], [r + 1, c - 1]].filter(([y, x]) => y < CAMP_ROWS && x >= 0).map(([y, x]) => slotAt(y, x))
    return ways.find((a) => canPlace(run, u, a)) ?? slot
  }

  // A tap on the board: a piece selects it (or lets it go); an open camp tile with a soul from the ossuary selected
  // places it there; anything else returns to the Monarch.
  function tapTile (t) {
    const o = pieceAt(t)
    // A relic readied: the soul tapped takes it; anywhere else lets it go.
    if (giving) { if (o) return give(o); giving = null; return render() }
    if (t == null) return select(null)
    if (o) return select(sel?.uid === o.uid ? null : { uid: o.uid })
    const p = selected()
    const slot = slotOfTile(t)
    if (p && !onField(p) && slot != null && !isWall(s.camp, slot)) return place(p, anchorFor(p, slot))
    select(null)
  }

  // ── the board under the pointer ──
  // A press on the board is a tap unless it moves past a few pixels: on a piece of yours (never the Monarch) it
  // lifts it. The tooltip follows the mouse from tile to tile; a finger's comes by a long press.

  stage.addEventListener('pointermove', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    const t = board.tileAt(e.clientX, e.clientY)
    if (t === hover && (t == null || document.querySelector('.tip.on'))) return
    hover = t
    board.hover(t)
    tileTip(t)
  })
  stage.addEventListener('pointerleave', (e) => {
    if (press || drag || e.pointerType === 'touch') return
    hover = null
    board.hover(null)
    hideTip()
  })
  stage.addEventListener('contextmenu', (e) => e.preventDefault())
  // The keyboard: the board takes focus (Tab); the arrows move a cursor over its tiles (from the Monarch's),
  // Enter or Space taps the tile under it. The tile's tooltip follows the cursor.
  let cursor = null
  let keyed = false
  stage.tabIndex = 0
  const keys = (on) => { keyed = on; stage.classList.toggle('kb', on) }
  const point = (t) => { cursor = t; hover = t; board.focus(t); board.hover(t); tileTip(t); keys(true) }
  const home = () => deployTile('party', monarchOf(s).slot)
  stage.addEventListener('focus', () => { if (!keeping && !drag && !press && stage.matches(':focus-visible')) point(cursor ?? home()) })
  stage.addEventListener('blur', () => { if (keeping || cursor == null) return; board.focus(null); board.hover(null); hover = null; hideTip() })
  stage.addEventListener('keydown', (e) => {
    if (drag || e.metaKey || e.ctrlKey || e.altKey) return
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key]
    if (step && cursor == null) point(home())
    else if (step) {
      const [x, y] = [tileX(cursor) + step[0], tileY(cursor) + step[1]]
      if (x >= 0 && x < LANES && y >= 0 && y < DEPTH) point(tileAt(x, y))
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor != null) tapTile(cursor)
    else return
    e.preventDefault()
    e.stopPropagation()
  })
  stage.addEventListener('pointerdown', (e) => {
    swallow = false
    if (cursor != null) { cursor = null; board.focus(null) }
    keys(false)
    if (e.button !== 0) return
    const t = board.tileAt(e.clientX, e.clientY)
    const o = pieceAt(t)
    // The Monarch never moves: a press on it is only ever a tap.
    begin(e, { tile: t, uid: o && !isMonarch(o) ? o.uid : null })
    // A finger held still on a tile pins its tooltip; it is then no tap.
    const q = press
    if (e.pointerType === 'touch' && e.isPrimary) {
      q.hold = hold(e, () => {
        if (press !== q || drag) return
        q.long = true
        const r = t != null && tips.has(t) && board.rectOf(t)
        if (!r) return
        board.hover(t)
        pinTip(r, tips.get(t), { onHide: () => { if (!drag) board.hover(null) } })
      })
    }
  })

  function pressBench (e, u) {
    swallow = false
    if (e.button !== 0) return
    begin(e, { uid: u.uid, bench: true })
  }

  function begin (e, p) {
    press = { x: e.clientX, y: e.clientY, e, t0: performance.now(), touch: e.pointerType === 'touch', ...p }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  function end () {
    press?.hold?.cancel()
    press = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }

  // The screen changed under a press (a key, a room entered, a tab): it is let go of, and nothing it would do is done.
  function release () {
    end()
    if (drag) cancelDrag(false)
    hover = null
  }

  // A finger on a soul in the bench scrolls the strip only when it holds more than it shows, the finger sets off
  // sideways (within 25° of it) before a long press, and it stays over the strip: any other way the soul lifts.
  const FLAT = Math.tan(25 * Math.PI / 180)
  const over = (list, e) => { const r = list.getBoundingClientRect(); return e.clientY >= r.top && e.clientY <= r.bottom }
  function onMove (e) {
    if (!el.isConnected) return release()
    if (!press || e.pointerId !== press.e.pointerId) return
    const [dx, dy] = [e.clientX - press.x, e.clientY - press.y]
    const far = Math.hypot(dx, dy) > 6
    if (press.scroll) {
      const { list, left } = press.scroll
      if (over(list, e)) { list.scrollLeft = left - dx / frame.k; return }
      press.scroll = null
    } else if (!drag && far && press.bench) {
      const list = press.touch && performance.now() - press.t0 < HOLD && el.querySelector('.bench')
      if (list && list.scrollWidth > list.clientWidth + 1 && Math.abs(dy) <= Math.abs(dx) * FLAT && over(list, e)) {
        press.scroll = { list, left: list.scrollLeft }
        swallow = true
        return
      }
    }
    if (!drag && far && press.uid != null) lift(e)
    if (drag) overMove(e)
  }

  function onUp (e) {
    if (!el.isConnected) return release()
    if (press && e.pointerId !== press.e.pointerId) return
    const p = press
    end()
    if (drag) return put(e)
    if (!p || p.long || p.bench) return
    tapTile(p.tile)
  }

  function onCancel () {
    if (!el.isConnected) return release()
    end()
    if (drag) cancelDrag()
  }

  // ── moving a piece ──

  function lift (e) {
    press.hold?.cancel()
    const u = soulOf(press.uid)
    drag = { uid: u.uid, at: undefined, target: null }
    if (press.bench) swallow = true
    hideTip()
    hover = null
    board.hover(null)
    document.body.classList.add('dragging')
    // Off the board (over the bench, the panel) the canvas is under the page: a picture of the piece carries it
    // there, at the board's size (the board's zoom is in viewport px, the ghost in the frame's).
    const size = Math.round(Math.max(40, 92 * board.zoom()) / frame.k)
    drag.ghost = h('div', { class: 'drag-ghost', hidden: true, style: `--s:${size}px` }, portrait(u.id, size, u.hp <= 0))
    frame.el.append(drag.ghost)
    board.lift(press.bench ? { id: u.id, size: sizeOf(u) } : `s${u.uid}`, e.clientX, e.clientY)
    render()
  }

  // The tiles a piece may be dropped on, by its footprint's anchor: every camp cell it may be placed at (run.js
  // canPlace: it fits there, or swaps with the one piece its footprint there covers).
  function dropTiles (u) {
    if (!u || isMonarch(u)) return []
    const out = []
    for (let slot = 0; slot < COLS * CAMP_ROWS; slot++) {
      if (slot !== u.slot && canPlace(run, u, slot)) out.push(deployTile('party', slot))
    }
    return out
  }

  // The drop under the pointer, and when it changes, what it would do (dragPreview) for the board to show. On the
  // board the tile is the footprint's anchor (board.js tileAt: for a 2×2, the cell under its rear-right quarter).
  function overMove (e) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)
    const onBench = hit?.closest?.('.bench-strip')
    const benched = onBench ? hit.closest('[data-uid]')?.dataset.uid : undefined
    const t = onBench ? null : board.tileAt(e.clientX, e.clientY)
    const at = onBench ? `b${benched ?? ''}` : String(t)
    const off = !hit?.closest?.('.stage-wrap')
    drag.ghost.hidden = !off
    const g = toLocal(e.clientX, e.clientY)
    drag.ghost.style.transform = `translate(${g.x}px, ${g.y}px)`
    let preview
    if (at !== drag.at) {
      drag.at = at
      drag.target = dropAt(soulOf(drag.uid), t, !!onBench, benched != null ? soulOf(+benched) : null)
      preview = dragPreview(soulOf(drag.uid), drag.target)
      el.querySelector('.bench')?.classList.toggle('over', !!drag.target?.bench && drag.target.ok)
    }
    board.follow(e.clientX, e.clientY, preview, off)
  }

  // Where a drop would land: a camp cell (its footprint's anchor) with the board tiles the footprint would cover
  // (`cells`, those it cannot take in `bad`: off the camp, a wall, the seat, another piece's but the one it would
  // swap with: run.js swapWith, the one piece under the whole footprint, none where two are), a tile past the camp
  // (slot null: all of them bad), the bench or a soul on it (`benched`: they swap), or nowhere (null); and whether
  // the rules take it (a refused one in the camp is still put down there, for its message).
  function dropAt (u, t, bench, benched) {
    if (bench) return { bench: true, benched, ok: !isMonarch(u) && onField(u) }
    if (t == null) return null
    const slot = slotOfTile(t)
    const size = sizeOf(u)
    const [x, y] = [tileX(t), tileY(t)]
    const cells = []
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (x + dx < LANES && y + dy < DEPTH) cells.push(tileAt(x + dx, y + dy))
    // Past the camp: every cell red, and a drop there is let go of.
    if (slot == null) return { tile: t, slot, size, cells, bad: cells, ok: false }
    const o = swapWith(run, u, slot)
    const held = heldBut(u, o === 'many' ? null : o)
    const whole = cells.length === size * size
    const bad = cells.filter((c) => {
      const sl = slotOfTile(c)
      return sl == null || !campOpen(s.camp, sl) || isMonarchCell(s.camp, sl) || held.has(sl)
    })
    return { tile: t, slot, size, cells, bad: whole ? bad : cells, ok: slot === u.slot || canPlace(run, u, slot) }
  }

  // What a drop would make of the board: the footprint's cells, lit, red where they do not fit; the one piece it
  // would displace (run.js swapWith) shown ghosted where it would go.
  function dragPreview (u, target) {
    if (!target || target.bench) return { tile: null, ok: !!target?.ok, swap: null }
    const base = { tile: target.tile, size: target.size, cells: target.cells, bad: target.bad, ok: target.ok }
    if (!target.ok || target.slot === u.slot) return { ...base, swap: null }
    const other = swapWith(run, u, target.slot)
    return { ...base, swap: other && other !== 'many' ? { key: `s${other.uid}`, id: other.id, size: sizeOf(other), to: onField(u) ? deployTile('party', u.slot) : null } : null }
  }

  // The drop: the move it stands for is made, or refused in words.
  function put (e) {
    overMove(e)
    const { uid, target } = drag
    cancelDrag(false)
    const u = soulOf(uid)
    if (!target || (!target.bench && target.slot == null)) { error = ''; return render() }
    if (target.bench) {
      if (!onField(u)) return render()
      return target.benched && target.benched !== u ? place(target.benched, u.slot) : place(u, OSSUARY)
    }
    place(u, target.slot)
  }

  function cancelDrag (redraw = true) {
    drag?.ghost?.remove()
    drag = null
    stage.classList.remove('dragging')
    document.body.classList.remove('dragging')
    board.drop()
    if (redraw) render()
  }

  render()
  return {
    el,
    // Its screen is about to change (a room entered, a tab): a press or a drag still held is let go of, doing nothing.
    release,
    // Put back on the page as it was (the Field tab again): the board is shown again.
    shown: render,
    key (e) {
      if (e.key !== 'Escape') return
      if (drag) { end(); return cancelDrag() }
      if (giving) giving = null
      else if (focusSyn) focusSyn = null
      else if (sel) sel = null
      else if (!error) return
      error = ''
      render()
    }
  }
}

// "your camp, front row, lane 4" → "Your camp, front row, lane 4".
const sentence = (t) => t.charAt(0).toUpperCase() + t.slice(1)
// A soul's relic, worn as a small gem in its tier's colour on its portrait (the board draws it on the sprite: engine.js
// growthMarks).
const relicMark = (u) => u.relics?.length > 0 && h('i', { class: `relic-mark rt-${relicDef(u.relics[0]).tier}`, 'aria-hidden': 'true' })

// ── cards: the spoils' and the Shop's ────────────────────────────────────────────────────────────

// Every offer's key, in the order the cards are shown: 1 to 9 and 0, then Q, W, E… By offer index.
const PICK_KEYS = [...'1234567890QWERTYUIOP']
const offerKeys = (offers) => new Map(offers.slice(0, PICK_KEYS.length).map((o, i) => [i, PICK_KEYS[i]]))

// The numbers in a card's effect line, picked out in the card's colour: +12%, 8 s, ×2, 40%.
const hiNums = (text) => String(text).split(/([+−×-]?\d+(?:\.\d+)?%?)/).map((part, k) => (k % 2 ? h('b', { class: 'num' }, part) : part))
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// ── arrivals: what is taken flies to where it now lives ──

// The things in flight sit on a layer of their own over the page (in the frame, so they scale with it), never
// in the pointer's way. A screen re-shown under them (the spoils after a pick) does not cut them short.
let flyLayer = null
const layer = () => {
  if (!flyLayer?.isConnected) frame.el.append(flyLayer = h('div', { class: 'fly-layer', 'aria-hidden': 'true' }))
  return flyLayer
}
const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 })

// `node` flies in an arc from viewport point `from` to `to`, shrinking to `scale`, after `delay` ms; the
// promise settles as it lands. The flight itself is drawn in the frame's px.
function flyOne (node, from, to, { delay = 0, ms = 560, scale = 0.5, lift = 60 } = {}) {
  from = toLocal(from.x, from.y)
  to = toLocal(to.x, to.y)
  node.classList.add('flyer')
  Object.assign(node.style, { left: `${from.x}px`, top: `${from.y}px` })
  layer().append(node)
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const at = (x, y, k) => `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${k})`
  const a = node.animate([
    { transform: at(0, 0, 0.6), opacity: 0 },
    { transform: at(0, -8, 1.15), opacity: 1, offset: 0.14 },
    { transform: at(dx / 2, dy / 2 - lift, 1), opacity: 1, offset: 0.55 },
    { transform: at(dx, dy, scale), opacity: 0.85 }
  ], { duration: ms, delay, easing: 'cubic-bezier(.45, .05, .5, 1)', fill: 'both' })
  return a.finished.catch(() => {}).finally(() => node.remove())
}

// A relic just taken flies from its card to its new tile in the top bar, and the tile pops in as
// it lands; a recruit's face flies to the souls' count.
function flyTrinket (o, rect) {
  const soul = o.type === 'soul'
  const find = () => document.querySelector(soul ? '.topbar .chip-stat.souls' : `.topbar .trinket[data-id="${o.id}"]`)
  const tile = find()
  if (!tile || !rect || still()) return
  if (!soul) tile.classList.add('arriving')
  const glyph = soul ? h('span', { class: 'soul-flyer' }, portrait(o.id, 64))
    : h('span', { class: `trinket-flyer rt-${relicDef(o.id).tier}` }, icon(relicIcon(o.id), 44))
  flyOne(glyph, centre(rect), centre(tile.getBoundingClientRect()), { ms: 680, scale: 0.36, lift: 90 }).then(() => {
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'new', 'gain')
    void now.offsetWidth
    now.classList.add(soul ? 'gain' : 'new')
  })
}

// The room whose cards were last dealt: a release (a buy) re-shows the same room, and its cards should not deal in
// again.
let dealt = null
const freshRoom = (run) => {
  const room = `${run.state.floor}|${run.state.at}`
  const fresh = !(dealt?.run === run && dealt.room === room)
  dealt = { run, room }
  return fresh
}
const RELIC_TIER_NAME = Object.fromEntries(RELIC_TIERS.map((x) => [x.id, x.name]))

// The parts the spoils and the Shop share: a card's refusal, its art's rect (for what flies from it), and by touch a
// card read before it is taken, as the map's rooms are entered (nothing needs a hover): the first tap chooses it and
// pins its full text with the taking button (`label`) under it; a second tap on it, or the button, takes it; a tap
// anywhere else lets it go. A mouse's click (its hover reads the card) and a card's key take it at once.
function cardDeck () {
  const cards = []
  let chosen = null
  return {
    cards,
    refuse (i) {
      sfx.play('poor')
      const c = cards[i]
      if (!c) return
      c.classList.remove('refuse')
      void c.offsetWidth
      c.classList.add('refuse')
    },
    artRect: (i) => (cards[i]?.querySelector('.offer-art') ?? cards[i])?.getBoundingClientRect(),
    press (e, i, tip, label, ok, take) {
      if (!touchy() || chosen === e.currentTarget) return take(i)
      const card = e.currentTarget
      chosen = card
      card.classList.add('chosen')
      pinTip(card, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); take(i) } }, label)], {
        keep: true,
        onHide: () => { card.classList.remove('chosen'); if (chosen === card) chosen = null }
      })
    }
  }
}

// Your souls, one line at the foot: how many. Where a soul may be let go (`open`: on the spoils, with no room for a
// recruit), the line opens (a press) a panel over the cards: each soul but the
// Monarch, with a Release button that says the essence it pays back (run.js releaseRefund: a share of what
// recruiting it would cost now). `busy()`: a card on its way, nothing pressed now; `again()`: the screen redrawn.
function soulsStrip ({ run, act, busy, again, why }) {
  const s = run.state
  let roster = false
  return (open) => {
    const n = souls(s.party).length
    const cap = rosterCap(run)
    if (!open) {
      return h('div', { class: 'ret-line', tip: () => `Souls ${n}/${cap}: ${ossuaryCount(run)}` },
        icon('hood', 20), h('b', null, 'Souls'), ` ${n}/${cap}`)
    }
    return h('div', { class: 'ret-strip' + (n >= cap ? ' full' : '') + (roster ? ' open' : '') },
      h('button', {
        class: 'ret-toggle', 'aria-expanded': roster ? 'true' : 'false',
        onclick: () => { roster = !roster; hideTip(); again() },
        tip: () => roster ? 'Close the list.' : why
      }, icon('hood', 20), h('b', null, `${n >= cap ? 'Full ' : 'Souls '}${n}/${cap}`), h('span', null, n >= cap ? ' · Release one to recruit' : ' · Release one'), h('span', { class: 'ret-caret', 'aria-hidden': 'true' }, roster ? '▾' : '▴')),
      roster && h('div', { class: 'ret-pop', role: 'region', 'aria-label': 'Release a soul' },
        h('div', { class: 'units' }, s.party.filter((u) => !isMonarch(u)).sort(fieldOrder).map((u) => unitRow(run, u, h('button', {
          class: 'danger small',
          onclick: () => { if (!busy()) { act({ type: 'release', uid: u.uid }); roster = false; again() } },
          tip: () => `Release ${unitDef(u.id).name} forever, freeing a place among your souls, for ${releaseRefund(run, u)} essence back (${Math.round(TUNING.essence.refund * 100)}% of what recruiting it would cost now). This can't be undone.`
        }, icon('release', 16), 'Release', h('span', { class: 'price' }, icon('soul', 14), `+${releaseRefund(run, u)}`)))))))
  }
}

// The Relics strip's parts (the Field's, and the spoils' below): its label, and the piece relics held by no
// soul, a button each (a copy more a ×N); `giving` is the one readied, `pick(id)` readies or lets go of one.
function relicChips (run, giving, pick) {
  const ids = unheld(run.state)
  const kinds = [...new Set(ids)]
  return [
    h('div', {
      class: 'bench-label',
      tip: () => {
        const free = souls(run.state.party).filter((u) => (u.relics?.length ?? 0) < TUNING.relic.perPiece).length
        return h('div', { class: 'syn-tip' }, h('b', null, `Relics to give · ${ids.length} unheld`),
          ids.length > 0 && h('p', null, `${tally(ids.map((id) => relicDef(id).name))} · ${free} soul${free === 1 ? ' has' : 's have'} a free slot.`),
          h('p', { class: 'dim' }, `${say('Click', 'Tap')} one, then a soul; a soul holding one swaps. Out of battle only.`))
      }
    }, h('b', null, 'Relics'), h('span', { class: 'dim' }, ` ${ids.length} unheld`)),
    h('div', { class: 'relics-unheld' }, kinds.map((id) => {
      const r = relicDef(id)
      const n = ids.filter((x) => x === id).length
      return h('button', {
        class: `give-relic rt-${r.tier}` + (giving === id ? ' on' : ''), 'aria-pressed': giving === id ? 'true' : 'false',
        onclick: () => pick(id),
        tip: () => h('div', null, relicTip(id, run), h('p', { class: 'dim' }, giving === id ? `${say('Click', 'Tap')} a soul to give it, or this again to cancel.` : `${say('Click', 'Tap')} it, then a soul, to give it.`))
      }, icon(relicIcon(id), 20), h('span', { class: 'gr-name' }, r.name), n > 1 && h('span', { class: 'relic-n' }, `×${n}`))
    }))]
}

// The piece relics, at the foot of the spoils (redesign.md §2.15: give, take back and swap out of battle,
// as the Field's Relics strip does, and by its gesture): a line of how many wait unheld; a press opens, over the cards,
// the same strip of them and a compact list of your souls, a row each: tap a relic, then a soul to give it (a soul
// holding one swaps); a soul's relic slot takes it back. Nothing while no piece relic is owned. `busy()`, `again()`:
// as soulsStrip's.
function relicsStrip ({ run, act, busy, again }) {
  const s = run.state
  let open = false
  let giving = null
  let error = ''
  return () => {
    if (!s.relics.some((id) => !isRunRelic(id))) return null
    if (giving && !unheld(s).includes(giving)) giving = null
    const n = unheld(s).length
    const go = (action) => { if (busy()) return; error = act(action) ?? ''; if (!error) sfx.play('buy'); again() }
    const give = (u) => {
      if (!giving) return
      if (!canHold(s, giving, u)) { error = `${unitDef(u.id).name} already holds ${relicDef(giving).name}.`; sfx.play('poor'); return again() }
      const relic = giving
      giving = null
      go({ type: 'hold', relic, uid: u.uid })
    }
    const row = (u) => {
      const held = u.relics ?? []
      const slot = (id) => h('button', {
        class: `give-relic small on rt-${relicDef(id).tier}`, onclick: () => (giving ? give(u) : go({ type: 'unhold', uid: u.uid, relic: id })),
        tip: () => giving ? `Swap it for ${relicDef(id).name}, which waits unheld.` : `Take ${relicDef(id).name} back from ${unitDef(u.id).name}: it waits unheld, to give again.`
      }, icon(relicIcon(id), 16), relicDef(id).name, giving ? '' : ' ✕')
      return h('div', { class: 'give-soul' + (giving && canHold(s, giving, u) ? ' gift' : '') },
        h('button', { class: 'gs-soul', onclick: () => give(u), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
          h('span', { class: 'rank-port' + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 32, u.hp <= 0)), h('b', null, unitDef(u.id).name)),
        held.length ? held.map(slot) : h('button', { class: 'give-relic small empty dim', onclick: () => give(u) }, '◇ empty'))
    }
    return h('div', { class: 'ret-strip relics' + (open ? ' open' : '') },
      h('button', {
        class: 'ret-toggle', 'aria-expanded': open ? 'true' : 'false',
        onclick: () => { open = !open; giving = null; error = ''; hideTip(); again() },
        tip: () => open ? 'Close the list.' : 'Give a piece relic to a soul, take one back, or swap: it works only through its holder.'
      }, icon('reliquary', 20), h('b', null, `Relics ${n} unheld`), h('span', { class: 'ret-caret', 'aria-hidden': 'true' }, open ? '▾' : '▴')),
      open && h('div', { class: 'ret-pop', role: 'region', 'aria-label': 'Give a relic' },
        n > 0 ? h('div', { class: 'relic-strip' }, relicChips(run, giving, (id) => { giving = giving === id ? null : id; error = ''; sfx.play('select'); again() }))
          : h('p', { class: 'dim' }, 'Every piece relic is held: a soul\'s slot takes one back.'),
        giving && h('p', { class: 'give-hint' }, h('b', null, say('Click', 'Tap')), ' a soul to give it ', h('b', { class: `c-${relicDef(giving).tier}` }, relicDef(giving).name), ' · again to cancel'),
        error && h('p', { class: 'warn' }, error),
        h('div', { class: 'give-souls' }, souls(s.party).sort(fieldOrder).map(row))))
  }
}

// Cards per row: up to `most` in one, more in rows as even as they come.
const cardRow = (n, most) => (n <= most ? Math.max(n, 1) : Math.ceil(n / Math.ceil(n / most)))
const mostCards = () => Math.max(3, Math.min(6, Math.floor((frame.w - 44 + 18) / (168 + 18))))

// ── reap ─────────────────────────────────────────────────────────────────────────────────────────

// The spoils' Shop fitted to its place, the reap body (spoils.css): its relics' pictures (--art) only as tall as leaves
// the cards' prices in view, 144 px down to 64 (a row of cards: by as much as they overflow; rows keep their own
// compact pictures). Whatever still lies below the fold, the body's or the fusions' column's, is marked `.more` (a
// fade and a ▾ along its foot) until scrolled into view. Again whenever the body changes size (a resize, a rotation).
const ART = { most: 144, least: 64 }
function fitShop (box) {
  if (!box.classList.contains('shopping')) return box
  const rect = (e) => e.getBoundingClientRect()
  // Logical px of `e` below the body's foot (frame.js: rects are in viewport px).
  const below = (e) => (rect(e).bottom - rect(box).bottom) / frame.k
  const mark = () => {
    if (box.firstElementChild) box.classList.toggle('more', below(box.firstElementChild) > 2)
    const fus = box.querySelector('.shop-fusions')
    if (fus) fus.classList.toggle('more', fus.scrollHeight - fus.clientHeight - fus.scrollTop > 2)
  }
  const fit = () => {
    if (!box.isConnected) return seen.disconnect()
    const offers = box.querySelector('.shop-relics .offers')
    box.style.setProperty('--art', `${ART.most}px`)
    if (offers && !offers.classList.contains('rows')) {
      // The cards' foot, and the panel's under them (its padding and edge), against the body's.
      const over = below(offers) + box.scrollTop + 16
      if (over > 0) box.style.setProperty('--art', `${Math.max(ART.least, ART.most - Math.ceil(over))}px`)
    }
    mark()
  }
  const seen = new ResizeObserver(fit)
  seen.observe(box)
  box.addEventListener('scroll', mark, { capture: true, passive: true })
  return box
}

// The spoils of a won battle: one of the slain to recruit (relics are the Shop's alone, redesign.md §2.11), what
// each wave paid, and a won elite's essence on top of its foes'. onDone(index): recruit offer `index`, or null to
// move on. The offers are cards to pick, framed in essence's colour. The Shop (shopView), its shelf just restocked,
// opens in their place at a press (B) and closes at another.
export function reapScreen ({ run, title, act, onDone, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen' })
  const full = () => souls(s.party).length >= rosterCap(run)
  const blocked = (o) => (full() ? 'full' : o.cost > s.essence ? 'poor' : null)
  let deal = freshRoom(run)
  const deck = cardDeck()
  let busy = false
  const keys = offerKeys(s.offers)
  const keyTag = (i) => keys.has(i) && h('kbd', null, keys.get(i))
  const later = (fn) => (still() ? fn() : setTimeout(fn, 300))
  const take = (i) => {
    if (busy) return
    if (i === null) return onDone(null)
    const o = soulOffer(run, s.offers[i])
    if (blocked(o)) return deck.refuse(i)
    const rect = deck.artRect(i)
    busy = true
    sfx.play('card')
    el.classList.add('picking')
    deck.cards[i]?.classList.add('taking')
    later(() => {
      onDone(i)
      flyTrinket(o, rect)
    })
  }
  const node = currentNode(run)
  // Hollow Court: the shadows that stood at the end of the battle just won paid their essence again.
  const shades = ['fight', 'elite', 'siege', 'boss'].includes(node.type) ? reapedShadows(run) : []
  const reaped = shades.length > 0 && `Hollow Court: ${shades.length} shadow${shades.length === 1 ? '' : 's'} still stood, and paid ${shades.length === 1 ? 'its' : 'their'} essence again.`
  // A battle of waves paid each wave as it fell: what each paid, relics included (essence gain).
  const boost = runStat(s, 'essence.gain', 1)
  const paid = node.waves?.length && run.battle ? essenceByWave(run.battle) : null
  const times = (v) => `×${+v.toFixed(2)}`
  const wavePay = paid && h('p', {
    class: 'wave-pay',
    tip: () => `${paid.map((v, k) => `Wave ${k + 1} ${Math.round(v * boost)}`).join(' + ')} = ${Math.round(paid.reduce((a, b) => a + b, 0) * boost)} essence${boost !== 1 ? `, relics' ${times(boost)} in` : ''}.`
  }, icon('soul', 18), ' Paid wave by wave: ', paid.map((v, k) => [k ? ' · ' : '', `Wave ${k + 1}`, ' ', h('b', null, Math.round(v * boost))]))
  // A won elite's panel, or a floor's boss's (no other boss room has spoils: the Sovereign's clears the run): its essence
  // on top of its foes' (run.js eliteBonus, relics included), and its recruit.
  const bounty = node.type === 'elite' || node.type === 'boss'
  const elitePay = bounty && h('p', {
    class: 'wave-pay elite-pay',
    tip: () => `${TUNING.essence.eliteBonus} at floor-1 prices, ${times(floorPrice(s.floor))} here${boost !== 1 ? `, ${times(boost)} by relics` : ''}: +${Math.round(eliteBonus(s.floor) * boost)}, on top of its foes'. ${node.type === 'boss' ? 'A boss' : 'An elite'} lays out no relic: the Shop sells those.`
  }, icon('soul', 18), ` The ${node.type === 'boss' ? 'boss' : 'elite'}'s bounty: `, h('b', null, `+${Math.round(eliteBonus(s.floor) * boost)}`), ' essence, on top of its foes\'.')
  // What the battle just won paid in all (run.js finishBattle: its slain, Hollow Court's shadows, an elite's bounty, ×
  // the relics' gain), and where a recruit would go.
  const won = run.battle && Math.round((essenceByWave(run.battle).reduce((a, b) => a + b, 0) + shades.reduce((n, u) => n + foeEssence(u, s.floor) * u.reap, 0) +
    (bounty ? eliteBonus(s.floor) : 0)) * boost)
  const ledeTip = () => {
    const f = fielded(souls(s.party)).length
    return h('div', { class: 'syn-tip' },
      won != null && h('p', null, `This battle paid +${won} essence; you have ${s.essence}.`),
      h('p', null, `One recruit a battle. Field ${f}/${fieldCap(run)}: ${f < fieldCap(run) ? 'a recruit joins it' : 'a recruit waits in the ossuary'} · souls ${souls(s.party).length}/${rosterCap(run)}.`))
  }
  const strip = soulsStrip({ run, act, busy: () => busy, again: () => render(), why: 'Your souls are at their most: open the list to release one, and make room for a recruit.' })
  const relics = relicsStrip({ run, act, busy: () => busy, again: () => render() })
  // The Shop, open over the cards (`shopping`) or not.
  let shopping = false
  const shop = shopView({ run, act, onChange: () => render() })
  const toggleShop = () => {
    if (busy) return
    shopping = !shopping
    hideTip()
    sfx.play('select')
    if (shopping) shop.render()
    render()
  }

  // A card: big art, the name, one line; the rest is on the hover. A recruit of a kind you already hold says what one
  // more is worth (codex.js recruitWorth): how many you hold, the synergy steps one more fielded would reach, the
  // tiers it shares, and how far it takes each fusion its kind is part of.
  function card (o, i) {
    const why = blocked(o)
    const worth = recruitWorth(run, o.id)
    // Its lead: its price, the level it joins at and where it would go (run.js join: the field while it has room).
    const lead = () => {
      const f = fielded(souls(s.party)).length
      return why === 'full' ? `Souls ${souls(s.party).length}/${rosterCap(run)}: release one to recruit`
        : `Recruit for ${o.cost}: joins at Lv ${o.lvl}, ${f < fieldCap(run) ? `on the field (${f + 1}/${fieldCap(run)})` : `in the ossuary (field ${f}/${fieldCap(run)})`}`
    }
    // A kind new to your souls: the synergy steps it would bring, fielded (codex.js recruitSteps).
    const fresh = () => {
      const steps = recruitSteps(run, o.id)
      return `New to your souls. Fielded, it brings ${steps.length ? steps.join(', ') : 'no new synergy'}.`
    }
    const tip = () => unitCard({ id: o.id, lvl: o.lvl, slot: -1 }, {
      // A click takes the card: a mouse reads its details on the hover itself, never under Shift.
      open: !touchy(),
      mods: partyMods(run),
      live: lead(),
      notes: [why === 'poor' ? `You need ${o.cost} essence; you have ${s.essence}.` : !why && `${say('Click', 'Tap it again (or Recruit ▸)')} to recruit it.`,
        ...(worth?.lines ?? [fresh()])]
    })
    const d = unitDef(o.id)
    return deck.cards[i] = h('button', { class: 'offer o-soul' + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Recruit ▸', () => !blocked(o), take), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, keyTag(i), h('span', { class: 'tag-word' }, ' Recruit')),
      h('div', { class: 'offer-art' }, portrait(o.id, 104)),
      h('div', { class: 'offer-name' }, o.name),
      worth && h('div', { class: 'offer-worth' }, worth.chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
      h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, o.lvl))),
      h('div', { class: 'offer-price' + (why ? ` ${why}` : '') }, icon('soul', 18), o.cost, why === 'full' && h('span', null, ' · full')))
  }

  function render () {
    deck.cards.length = 0
    // A recruit read as the run stands now (run.js soulOffer).
    const offers = s.offers.map((o, i) => card(soulOffer(run, o), i))
    const cols = cardRow(offers.length, mostCards())
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon(node.type === 'elite' ? 'elite' : 'soul', 34), h('h1', null, title)),
          h('p', { class: 'reap-lede' }, s.offers.length ? ['Recruit one of the slain for ', kw('essence'), ', or move on.'] : 'None of the slain can be recruited.',
            h('span', { class: 'lede-more', tabindex: '0', tip: ledeTip }, icon('help', 22)))),
        elitePay,
        reaped && h('p', { class: 'note-line reap-note' }, reaped),
        wavePay,
        fitShop(h('div', { class: 'reap-body' + (shopping ? ' shopping' : '') },
          shopping ? shop.el : h('div', { class: 'reap-picks' },
            offers.length > 0 && h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (offers.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, offers)))),
        h('div', { class: 'reap-foot' },
          strip(s.offers.length > 0 && full()),
          relics(),
          h('div', { class: 'reap-actions' },
            h('button', {
              class: 'ghost big open-shop' + (shopping ? ' on' : ''), 'aria-pressed': shopping ? 'true' : 'false', onclick: toggleShop,
              tip: () => shopping ? 'Back to the spoils. (B)' : 'Open the Shop: its relics, restocked by this win, and your fusions. (B)'
            }, icon('shop', 20), shopping ? 'Spoils ' : 'Shop ', h('kbd', null, 'B')),
            h('button', { class: 'ghost big move-on', onclick: () => take(null), tip: () => `Go on.${s.offers.length ? ' The slain not recruited are lost.' : ''} (S)` }, 'Move on ', h('kbd', null, 'S'))))))
    if (!shopping) deal = false
  }

  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = !shopping && [...keys].find(([, k]) => e.key.toUpperCase() === k)
      if (hit) take(hit[0])
      else if (e.key === 'b' || e.key === 'B') toggleShop()
      else if (e.key === 's' || e.key === 'S') take(null)
    }
  }
}

// ── the draft ────────────────────────────────────────────────────────────────────────────────────

// The run's first souls (run.js draftOffer, TUNING.draft: one since 2026-10-18): each pick deals the kinds offered as
// cards, free, and the one taken flies down into its seat along the foot, where the seats still empty wait.
// onPick(index) takes offer `index`; the last pick opens the map. A kind offered again can be taken again: a second
// soul of a kind says what it is worth (codex.js recruitWorth), a first the fusions its kind goes into. With one pick,
// the lede and the foot speak of one soul.
let draftDealt = null
export function draftScreen ({ run, onPick, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen draft-screen' })
  const n = TUNING.draft.picks
  const k = s.draft.pick
  const offer = s.draft.offer
  const deal = !(draftDealt?.run === run && draftDealt.pick === k)
  draftDealt = { run, pick: k }
  const deck = cardDeck()
  const keys = offerKeys(offer)
  let busy = false
  const take = (i) => {
    if (busy) return
    busy = true
    const rect = deck.artRect(i)
    hideTip()
    sfx.play('card')
    el.classList.add('picking')
    deck.cards[i]?.classList.add('taking')
    const go = () => {
      onPick(i)
      seatSoul(offer[i], rect, k)
    }
    still() ? go() : setTimeout(go, 300)
  }
  const lvlOf = (id) => s.kinds[id]?.lvl ?? levelOf({ tracks: [0, 0] })
  // A kind new to the run: the fusions it goes into, from the recipes (content.js FUSION_LIST).
  const recipesOf = (id) => FUSION_LIST.filter((f) => Object.hasOwn(f.needs, id))
  function card (id, i) {
    const d = unitDef(id)
    const worth = recruitWorth(run, id)
    const recipes = recipesOf(id)
    const notes = worth?.lines ?? (recipes.length ? recipes.map((f) => `Fusion: ${f.desc}`) : ['It goes into no fusion.'])
    const tip = () => unitCard({ id, lvl: lvlOf(id), slot: -1 }, {
      open: !touchy(),
      live: `Joins free at Lv ${lvlOf(id)}, on the field`,
      notes: [`${say('Click', 'Tap it again (or Raise ▸)')} to raise it.`, ...notes]
    })
    const chips = worth?.chips ?? recipes.map((f) => ({ text: `Fuses into ${f.name}` }))
    return deck.cards[i] = h('button', { class: 'offer o-soul', style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Raise ▸', () => true, take), tip },
      h('div', { class: 'offer-tag' }, keys.has(i) && h('kbd', null, keys.get(i)), h('span', { class: 'tag-word' }, ' Raise')),
      h('div', { class: 'offer-art' }, portrait(id, 104)),
      h('div', { class: 'offer-name' }, d.name),
      chips.length > 0 && h('div', { class: 'offer-worth' }, chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
      h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name}`),
      h('div', { class: 'offer-line draft-reach' }, reachText({ id, lvl: lvlOf(id), tracks: s.kinds[id]?.tracks ?? [0, 0] })))
  }
  // The seats: one a pick, a soul's face in each taken, the next marked.
  const picked = souls(s.party)
  const seat = (j) => {
    const u = picked[j]
    return h('div', {
      class: 'draft-seat' + (u ? ' taken' : j === k ? ' next' : ''), 'data-n': j,
      tip: u ? () => unitCard(u, { notes: ['Taken.'] }) : () => (j === k ? 'This pick.' : `Pick ${j + 1}.`)
    }, u ? portrait(u.id, 54) : h('span', { class: 'seat-n' }, j + 1))
  }
  const cards = offer.map(card)
  fill(el,
    topbar(run, onHelp),
    h('div', { class: 'reap-main' },
      h('div', { class: 'reap-head' },
        h('div', { class: 'reap-title' }, icon('soul', 34), h('h1', null, 'Raise your retinue')),
        h('p', { class: 'reap-lede' }, n > 1 ? `Pick ${k + 1} of ${n}: choose a soul to walk with you. A kind can be offered again.` : 'Choose a soul to walk with you.')),
      h('div', { class: 'reap-body' },
        h('div', { class: 'reap-picks' },
          h('div', { class: 'offers picks' + (deal ? ' deal' : ''), style: `--cols:${cards.length}` }, cards))),
      h('div', { class: 'reap-foot draft-foot' },
        h('span', { class: 'draft-label' }, n > 1 ? 'Your souls' : 'Your soul'),
        h('div', { class: 'draft-seats' }, Array.from({ length: n }, (_, j) => seat(j))),
        h('p', { class: 'draft-after' }, `After ${n > 1 ? 'these' : 'it'}, every soul is recruited from the slain.`))))
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const hit = [...keys].find(([, key]) => e.key.toUpperCase() === key)
      if (hit) take(hit[0])
    }
  }
}

// A soul just drafted flies from its card into its seat on the screen shown next (draftScreen), or, after the last
// pick, to the souls' count in the map's top bar; the place it lands pops.
function seatSoul (id, rect, k) {
  const find = () => document.querySelector(`.draft-seat[data-n="${k}"]`) ?? document.querySelector('.topbar .chip-stat.souls')
  const to = find()
  if (!to || !rect || still()) return
  to.classList.add('arriving')
  flyOne(h('span', { class: 'soul-flyer' }, portrait(id, 64)), centre(rect), centre(to.getBoundingClientRect()), { ms: 620, scale: 0.7, lift: 70 }).then(() => {
    const now = find()
    if (!now) return
    now.classList.remove('arriving', 'gain')
    void now.offsetWidth
    now.classList.add('gain')
  })
}

// ── the Shop ─────────────────────────────────────────────────────────────────────────────────────

// The Shop (redesign.md §2.11; DESIGN Next, Step 3): no room, but the floor's shelf, open wherever essence is spent: a
// tab of the run's screen beside the Field, the Map and the Codex, and a press away on the spoils; closed in battle. Two
// sections. Relics: the shelf's slots (run.js shopOffers: a slot null once bought, filled again after the next battle
// won), each card with its price, lit only while the purse (the bar's essence) pays for it, any number bought.
// Fusions: every recipe whose parts are all held (run.js fuseParts), lit when the essence suffices, its one button the
// fuse action (the run picks the pieces, whole: the ossuary's first, then the fielded; the fused piece waits in the
// ossuary); then, dim, the recipes a kind held goes into, each part counted, so the plan is in view with its price.
// `onChange` runs after every action it sends (the bar redrawn). → { el, render }
export function shopView ({ run, act, onChange = null }) {
  const s = run.state
  const el = h('section', { class: 'panel shop-panel reap-screen shop-screen', 'aria-label': 'The Shop' })
  let deal = true
  let said = ''
  const deck = cardDeck()
  const done = () => { hideTip(); render(); onChange?.() }
  const buy = (i) => {
    const o = shopOffers(run)[i]
    if (!o) return
    if (!canBuy(run, i)) return deck.refuse(i)
    const rect = deck.artRect(i)
    if (act({ type: 'buy', index: i })) return deck.refuse(i)
    sfx.play('buy')
    said = ''
    done()
    flyTrinket(o, rect)
  }

  function card (o, i) {
    if (!o) {
      return deck.cards[i] = h('div', { class: 'offer o-sold', style: `--i:${i}`, tip: () => 'Bought. The slot fills again after your next win.' },
        h('div', { class: 'offer-art' }, icon('shop', 48)), h('div', { class: 'offer-name' }, 'Bought'), h('div', { class: 'offer-sub' }, 'Restocked after a win'))
    }
    const why = canBuy(run, i) ? null : 'poor'
    const r = relicDef(o.id)
    const copies = relicCount(s, o.id)
    const tip = () => h('div', null, relicTip(o.id, run),
      h('p', { class: 'dim' }, why ? `You need ${o.cost} essence; you have ${s.essence}.` : `${say('Click', 'Tap it again (or Buy ▸)')} to buy it for ${o.cost} essence.`))
    return deck.cards[i] = h('button', { class: `offer o-relic o-${o.tier} rt-${o.tier}` + (why ? ' locked' : ''), style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Buy ▸', () => canBuy(run, i), buy), 'aria-disabled': why ? 'true' : null, tip },
      h('div', { class: 'offer-tag' }, h('span', { class: 'tag-word' }, RELIC_TIER_NAME[o.tier]),
        h('span', { class: 'kind-tag', tip: () => isRunRelic(o.id) ? 'A run relic: it works for the whole run, unheld.' : 'A piece relic: it works only through the soul you give it to, on the Field.' }, relicKind(o.id))),
      h('div', { class: 'offer-art' }, icon(relicIcon(o.id), 64),
        r.on && h('span', { class: 'trig-tag', tip: () => `Fires each time ${TRIGGER_TEXT[r.on].short}` }, TRIGGER_TEXT[r.on].name)),
      h('div', { class: 'offer-name' }, o.name),
      copies > 0 && h('div', { class: 'offer-sub' }, isRunRelic(o.id) ? `Owned ×${copies}: one more adds to it` : `Owned ×${copies}: one more is another holder`),
      h('div', { class: 'offer-line' }, hiNums(o.desc)),
      h('div', { class: 'offer-price' + (why ? ' poor' : '') }, icon('soul', 18), o.cost))
  }

  // The purse against the shelf: "You have 120: 2 of these 4 are within reach."
  function shelfLine () {
    const left = shopOffers(run).filter(Boolean)
    const k = left.filter((o) => o.cost <= s.essence).length
    return !left.length ? `You have ${s.essence}; the shelf is bare until your next win.`
      : `You have ${s.essence}: ${k === left.length ? (k === 1 ? 'the last relic is' : `all ${k} relics are`) : `${k} of these ${left.length} relics ${k === 1 ? 'is' : 'are'}`} within reach.`
  }

  // By touch a fusion is read before it is made, as a card is: the first tap pins its text with `label` under it, and a
  // second tap on it, or that button, makes it. A click makes it at once: its hover read it.
  let reading = null
  function twice (e, tip, label, ok, go) {
    const b = e.currentTarget
    if (!touchy() || reading === b) { reading = null; return go(e) }
    reading = b
    b.classList.add('chosen')
    pinTip(b, () => [tip(), ok() && h('button', { class: 'primary small tip-act', onclick: () => { hideTip(); reading = null; go(e) } }, label)], {
      keep: true,
      onHide: () => { b.classList.remove('chosen'); if (reading === b) reading = null }
    })
  }
  const shake = (e) => {
    const t = e?.currentTarget
    if (!t?.classList) return
    t.classList.remove('shake')
    void t.offsetWidth
    t.classList.add('shake')
  }

  // A recipe's row: its result's picture (its card on hover), its name, its parts (of the souls of each kind it takes,
  // how many you hold) and, where every part is held, its button, lit when the essence suffices.
  const heldOf = (k) => souls(s.party).filter((x) => x.id === k).length
  function fuseRow (f, entry = null) {
    const d = unitDef(f.result)
    const k = s.kinds[f.result]
    return h('div', { class: 'fuse-row' + (entry?.can ? ' ready' : '') + (entry ? '' : ' toward') },
      h('span', { tip: () => unitCard({ id: f.result, lvl: k?.lvl ?? 1, tracks: k?.tracks ?? [0, 0] }, { realm: realmOf(run), notes: [f.desc] }) }, portrait(f.result, 40)),
      h('div', { class: 'fuse-text' },
        h('div', null, h('b', null, f.name), h('span', { class: 'dim' }, ` · tier ${d.tier}${(d.size ?? 1) > 1 ? ' · 2×2' : ''}`)),
        h('div', { class: 'fuse-parts' }, Object.entries(f.needs).map(([id, n]) => {
          const have = heldOf(id)
          return h('span', { class: have >= n ? 'met' : 'short' }, `${unitDef(id).name} ${Math.min(have, n)}/${n}`)
        }))),
      entry ? fuseButton(f, entry) : h('span', { class: 'price dim', tip: () => `${fuseCost(run, f.id)} essence once every part is held.` }, icon('soul', 16), fuseCost(run, f.id)))
  }
  // A ready recipe's button: the one fuse action (run.js shelfFusions: the parts the run picks, whole, the ossuary's
  // first), lit when it can be made now; on the spoils it waits for the map.
  function fuseButton (f, entry) {
    const { cost, can, open } = entry
    // Each part a piece of its own: its name, and where it stands now.
    const partsText = entry.action.parts.map((uid) => {
      const p = s.party.find((x) => x.uid === uid)
      return `the ${unitDef(p.id).name} ${onField(p) ? `on ${tileText(deployTile('party', p.slot)).replace(/^your camp, /, '')}` : 'in the ossuary'}`
    }).join(', ')
    const tip = () => h('div', { class: 'syn-tip' }, h('b', null, f.name), ' ', f.desc,
      !open ? h('p', { class: 'warn' }, `Fused on the map, once the spoils are done: it takes ${partsText}, for ${cost} essence.`)
        : s.essence < cost ? h('p', { class: 'warn' }, `Needs ${cost} essence; you have ${s.essence}.`)
          : h('p', { class: 'dim' }, `It takes ${partsText}, for ${cost} essence; the ${unitDef(f.result).name} waits in the ossuary.`))
    const press = (e) => {
      if (!can) { sfx.play('poor'); return shake(e) }
      const error = act(entry.action)
      if (error) { said = error; sfx.play('poor'); return done() }
      learnt('fuse')
      sfx.play('buy')
      said = `${unitDef(f.result).name} is made: it waits in the ossuary.`
      done()
    }
    // Dim while it cannot be made; its price red only when the essence is short (on the spoils it waits for the map).
    return h('button', {
      class: 'buy' + (can ? '' : ' off') + (s.essence < cost ? ' poor' : ''), 'aria-disabled': can ? null : 'true', 'aria-label': `Fuse ${f.name}`,
      onclick: (e) => twice(e, tip, `Fuse ${f.name} ▸`, () => can, press),
      tip
    }, icon('fuse', 18), 'Fuse', h('span', { class: 'price' }, icon('soul', 16), cost))
  }
  function fusions () {
    const ready = shelfFusions(run)
    const share = (f) => Object.entries(f.needs).reduce((n, [id, k]) => n + Math.min(heldOf(id), k), 0) / Object.values(f.needs).reduce((n, k) => n + k, 0)
    const toward = FUSION_LIST.filter((f) => !ready.some((x) => x.id === f.id) && Object.keys(f.needs).some((id) => heldOf(id) > 0))
      .map((f) => ({ f, at: share(f) })).sort((a, b) => b.at - a.at).map((x) => x.f)
    return h('div', { class: 'shop-sec shop-fusions' },
      h('h3', null, kw('fusion', 'Fusions'), h('span', { class: 'dim' }, ` · ${ready.length} ready`)),
      // On the spoils a ready recipe waits for the map: said, not only on its button's hover.
      ready.some((x) => !x.open) && h('p', { class: 'dim small fuse-wait' }, 'Fused on the map, once the spoils are done.'),
      ready.length ? h('div', { class: 'fuse-list' }, ready.map((x) => fuseRow(fusionDef(x.id), x)))
        : h('p', { class: 'dim small' }, 'No recipe has every part held yet. Recruit its kinds from the slain.'),
      toward.length > 0 && [h('p', { class: 'dim small shop-toward' }, 'Toward, from the kinds you hold:'), h('div', { class: 'fuse-list' }, toward.map((f) => fuseRow(f)))])
  }

  function render () {
    deck.cards.length = 0
    const stock = shopOffers(run).map(card)
    const cols = cardRow(stock.length, Math.min(4, mostCards()))
    fill(el,
      h('div', { class: 'shop-head' },
        h('div', { class: 'reap-title' }, icon('shop', 30), h('h2', null, 'Shop')),
        h('p', { class: 'reap-lede' }, [kw('relic', 'Relics'), ' and ', kw('fusion', 'fusions'), ' for ', kw('essence'), `. ${shelfLine()}`])),
      said && h('p', { class: 'note-line shop-said', role: 'status' }, said),
      h('div', { class: 'shop-cols' },
        h('div', { class: 'shop-sec shop-relics' },
          h('h3', null, kw('relic', 'Relics'), h('span', { class: 'dim' }, ` · a slot bought fills again after your next win`)),
          h('div', { class: 'offers picks' + (deal ? ' deal' : '') + (stock.length > cols ? ' rows' : ''), style: `--cols:${cols}` }, stock)),
        fusions()))
    deal = false
  }

  render()
  return { el, render }
}

// ── the altar (redesign.md §4.5) ─────────────────────────────────────────────────────────────────

// An altar: one rite of three, and the room ends with it (run.js altarActions). The rites are tabs, the heal open first
// where anything is hurt or fallen (or nothing has a tier left), else the free tier: Heal (what it mends and raises now,
// and its button at the foot); Transmute (a standing soul chosen, then the kinds the altar offers it as cards, the
// draft's: run.js transmuteOffer); Consecrate (a kind chosen, then its two tracks' next tiers as cards, free). A card is
// taken as the spoils' are (cardDeck: a click; by touch a tap reads it, a second takes it), and its keys are 1, 2, 3.
// onRite(action) takes the rite.
const RITES = [
  { id: 'heal', name: 'Heal', ico: 'altar', desc: 'Every soul healed, the Monarch too, and the fallen raised.' },
  { id: 'transmute', name: 'Transmute', ico: 'soul', desc: 'One standing soul becomes another kind of its tier, one of this floor\'s foes.' },
  { id: 'consecrate', name: 'Consecrate', ico: 'levelup', desc: 'One kind takes its next tier on a track you choose, free.' }
]
export function altarScreen ({ run, onRite, onHelp }) {
  const s = run.state
  const el = h('div', { class: 'screen fit reap-screen altar-screen' })
  const deck = cardDeck()
  const t = TUNING.run
  const turnable = souls(s.party).sort(fieldOrder).filter((u) => canTransmute(s, u))
  const kinds = heldKinds(s).filter((k) => canAdvance(s, k, 0) || canAdvance(s, k, 1))
  // What the heal would mend now: the souls below altarHeal of their HP (the Monarch unless nothing may heal it), the
  // fallen.
  const mends = (u) => (u.hp <= 0 ? !isMonarch(u) : u.hp < Math.round(u.maxHp * t.altarHeal) && !(isMonarch(u) && unhealed(s)))
  const hurt = s.party.filter(mends)
  let tab = hurt.length || !kinds.length ? 'heal' : 'consecrate'
  let soul = turnable[0]?.uid ?? null
  let kind = kinds[0] ?? null
  let busy = false
  let deal = true
  const take = (action, i = null) => {
    if (busy) return
    busy = true
    hideTip()
    sfx.play(i === null ? 'buy' : 'card')
    if (i !== null) { el.classList.add('picking'); deck.cards[i]?.classList.add('taking') }
    i === null || still() ? onRite(action) : setTimeout(() => onRite(action), 300)
  }
  const pick = (k) => { tab = k; deal = true; hideTip(); sfx.play('select'); render() }

  // The rites' tabs, each with its count now.
  const count = {
    heal: () => (hurt.length ? `${hurt.filter((u) => u.hp > 0).length} hurt · ${hurt.filter((u) => u.hp <= 0).length} fallen` : 'nothing hurt'),
    transmute: () => `${turnable.length} soul${turnable.length === 1 ? '' : 's'}`,
    consecrate: () => `${kinds.length} kind${kinds.length === 1 ? '' : 's'}`
  }
  const tabs = () => h('div', { class: 'tabs rite-tabs', role: 'tablist', 'aria-label': 'Rites' }, RITES.map((r) => h('button', {
    class: `tab rite-tab r-${r.id}` + (tab === r.id ? ' on' : ''), role: 'tab', 'aria-selected': tab === r.id ? 'true' : 'false', 'data-rite': r.id,
    onclick: () => pick(r.id), tip: () => h('div', { class: 'syn-tip' }, h('b', null, r.name), h('p', null, r.desc), h('p', { class: 'dim' }, `Now: ${count[r.id]()}.`))
  }, icon(r.ico, 20), h('span', null, r.name), h('span', { class: 'rite-n dim' }, count[r.id]()))))

  // A chooser beside the cards: a column of buttons, a soul or a kind each, the chosen pressed; the rite's line and its
  // cards beside it (in a short frame compact, as the spoils' rows: the chooser takes the height).
  const chooser = (label, items) => h('div', { class: 'rite-side' }, h('div', { class: 'rite-label dim' }, label), h('div', { class: 'rite-choose', role: 'group', 'aria-label': label }, items))
  const split = (side, say, cards) => h('div', { class: 'rite-panel split' }, side,
    h('div', { class: 'rite-main' }, h('p', { class: 'rite-say' }, say),
      h('div', { class: 'offers picks' + (frame.h < 640 ? ' rows' : '') + (deal ? ' deal' : ''), style: `--cols:${cards.length}` }, cards)))
  const option = (on, face, name, sub, onclick, tip) => h('button', { class: 'rite-opt' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', onclick, tip },
    h('span', { class: 'rank-port' }, face), h('span', { class: 'rite-opt-text' }, h('b', null, name), h('span', { class: 'dim' }, sub)))

  // Heal: what it mends and raises now, a soul each.
  function healPanel () {
    const after = (u) => (u.hp > 0 ? Math.max(u.hp, Math.round(u.maxHp * t.altarHeal)) : Math.ceil(u.maxHp * t.altarRevive))
    return h('div', { class: 'rite-panel' },
      h('p', { class: 'rite-say' }, roomGain(run, { type: 'altar' })),
      unhealed(s) && h('p', { class: 'warn' }, 'Court of Bone: not the Monarch.'),
      hurt.length > 0 && h('div', { class: 'rite-mends' }, hurt.map((u) => h('div', { class: 'rite-mend', tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
        h('span', { class: 'rank-port' + (isMonarch(u) ? ' monarch' : '') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40, u.hp <= 0)),
        h('span', null, h('b', null, unitDef(u.id).name), h('span', { class: 'dim' }, u.hp > 0 ? ` ${u.hp} → ${after(u)}` : ` rises at ${after(u)}`))))))
  }

  // Transmute: the soul, then the kind it becomes, a card each (codex.js transmuteWorth).
  function transmutePanel () {
    if (!turnable.length) return h('div', { class: 'rite-panel' }, h('p', { class: 'rite-say' }, 'No soul here can be transmuted: the fallen wait for a heal, and a fused soul is made, not met.'))
    const u = s.party.find((x) => x.uid === soul)
    const offer = transmuteOffer(s, u.id)
    const card = (id, i) => {
      const d = unitDef(id)
      const worth = transmuteWorth(run, u, id)
      const tip = () => unitCard({ id, lvl: worth.lvl, tracks: s.kinds[id]?.tracks ?? [0, 0], slot: -1 }, {
        open: !touchy(), realm: realmOf(run), live: `${unitDef(u.id).name} → ${d.name}, Lv ${worth.lvl}`,
        notes: [`${say('Click', 'Tap it again (or Transmute ▸)')} to transmute it. (${i + 1})`, ...worth.lines]
      })
      const action = { type: 'transmute', uid: u.uid, index: i }
      return deck.cards[i] = h('button', { class: 'offer o-soul o-turn', style: `--i:${i}`, onclick: (e) => deck.press(e, i, tip, 'Transmute ▸', () => true, () => take(action, i)), tip },
        h('div', { class: 'offer-tag' }, h('kbd', null, i + 1), h('span', { class: 'tag-word' }, ' Becomes')),
        h('div', { class: 'offer-art' }, portrait(id, 104)),
        h('div', { class: 'offer-name' }, d.name),
        h('div', { class: 'offer-worth' }, worth.chips.map((c) => h('span', { class: 'ow-chip' + (c.up ? ' up' : '') }, c.text))),
        h('div', { class: 'offer-line' }, `${KIN[d.kin].name} ${ROLES[d.role].name} · `, h('span', { class: 'nowrap' }, 'level ', h('b', { class: 'num' }, worth.lvl))))
    }
    const cards = offer.map(card)
    return split(
      chooser('The soul', turnable.map((x) => option(x.uid === soul, portrait(x.id, 36), unitDef(x.id).name, ` Lv ${x.lvl} · tier ${unitDef(x.id).tier}`,
        () => { if (x.uid !== soul) { soul = x.uid; deal = true; sfx.play('select'); render() } },
        () => unitCard(x, { mods: partyMods(run, x), realm: realmOf(run), run, notes: [`${say('Click', 'Tap')} it, then the kind it becomes.`] })))),
      `It becomes one of this floor's foes of its tier, keeping its relic, its wounds and its level. Tiers stay with their kind: the ${unitDef(u.id).name}'s with the ${unitDef(u.id).name}, and it takes its new kind's.`,
      cards)
  }

  // Consecrate: the kind, then a track's next tier, a card each.
  function consecratePanel () {
    if (!kinds.length) return h('div', { class: 'rite-panel' }, h('p', { class: 'rite-say' }, 'Every kind you hold has taken all the tiers its tracks allow.'))
    const k = s.kinds[kind]
    const name = unitDef(kind).name
    const lvl = kindLevel(s, kind)
    const card = (tr, i) => {
      const have = k.tracks[i]
      const can = canAdvance(s, kind, i)
      const tier = tr.tiers[have]
      const up = can ? levelOf({ ...k, tracks: nextTracks(k.tracks, i) }) : lvl
      const why = can ? null : have >= tr.tiers.length ? 'Complete.' : `Locked: ${tracksOf(kind)[1 - i].name} has passed II, so ${tr.name} stops at II.`
      const tip = () => h('div', { class: 'syn-tip' }, h('p', null, h('b', null, `${tr.name} ${can ? ROMAN[have] : ''}`), ' ', can ? tier.desc : tr.desc),
        can ? h('p', { class: 'dim' }, `Free here (${tierCost(run, kind, i)} essence in the Field), for every ${name}. ${up > lvl ? `Level ${lvl} → ${up}.` : `Level stays ${lvl}.`} ${say('Click', 'Tap it again (or Consecrate ▸)')} to take it. (${i + 1})`)
          : h('p', { class: 'warn' }, why))
      const action = { type: 'consecrate', kind, track: i }
      return deck.cards[i] = h('button', { class: 'offer o-tier' + (can ? '' : ' locked'), style: `--i:${i}`, 'aria-disabled': can ? null : 'true', onclick: (e) => deck.press(e, i, tip, 'Consecrate ▸', () => can, () => (can ? take(action, i) : deck.refuse(i))), tip },
        h('div', { class: 'offer-tag' }, h('kbd', null, i + 1), h('span', { class: 'tag-word' }, ` Track ${i + 1}`)),
        h('div', { class: 'offer-art' }, portrait(kind, 84), h('span', { class: 'tier-badge' }, can ? ROMAN[have] : '✓')),
        h('div', { class: 'offer-name' }, tr.name, can && ` ${ROMAN[have]}`),
        h('div', { class: 'offer-line' }, can ? hiNums(tier.desc) : why),
        h('div', { class: 'offer-price' + (can ? '' : ' poor') }, can ? ['Free', up > lvl && h('span', { class: 'dim' }, ` · Lv ${lvl} → ${up}`)] : 'No tier'))
    }
    const cards = tracksOf(kind).map(card)
    return split(
      chooser('The kind', kinds.map((id) => option(id === kind, portrait(id, 36), unitDef(id).name, ` Lv ${kindLevel(s, id)} · tiers ${s.kinds[id].tracks.join('·')}`,
        () => { if (id !== kind) { kind = id; deal = true; sfx.play('select'); render() } },
        () => h('div', { class: 'syn-tip' }, h('b', null, unitDef(id).name), h('p', null, tracksOf(id).map((tr, i) => `${tr.name} ${s.kinds[id].tracks[i]}/${tr.tiers.length}`).join(' · ')), h('p', { class: 'dim' }, `${say('Click', 'Tap')} it, then a track.`))))),
      `Every ${name} takes its next tier on the track you choose, free, as buying it would give it.`,
      cards)
  }

  function render () {
    deck.cards.length = 0
    const panel = tab === 'heal' ? healPanel() : tab === 'transmute' ? transmutePanel() : consecratePanel()
    fill(el,
      topbar(run, onHelp),
      h('div', { class: 'reap-main' },
        h('div', { class: 'reap-head' },
          h('div', { class: 'reap-title' }, icon('altar', 34), h('h1', null, 'Altar')),
          h('p', { class: 'reap-lede' }, ['One rite, then the altar is spent: ', kw('altar', 'heal, transmute or consecrate'), '.'])),
        tabs(),
        h('div', { class: `reap-body rite-body r-${tab}` }, panel),
        h('div', { class: 'reap-foot rite-foot' },
          h('p', { class: 'dim rite-hint' }, tab === 'heal' ? RITES[0].desc : `${say('Click', 'Tap')} a card to ${tab}; another rite's tab to change your mind.`),
          h('div', { class: 'reap-actions' },
            tab === 'heal' && h('button', { class: 'primary big', onclick: () => take({ type: 'heal' }), tip: () => `Heal: ${RITES[0].desc} The altar is then spent.` }, icon('altar', 20), 'Heal ▸')))))
    deal = false
  }

  render()
  return {
    el,
    key (e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const i = Number(e.key) - 1
      if (tab !== 'heal' && deck.cards[i]) deck.cards[i].click()
    }
  }
}

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

// Three ends. The Sovereign slain (over, 'victory', no death): the run is cleared, and the deep lies below
// (Descend, or stop here with a new run). A fall in the deep after that clear ('victory' with a death): the
// clear stands. A defeat on the way down: as it was.
// `opened`: the ascension this run's clear opened (main.js, run.js clearAt), or null; `crowned`, the Monarchs it opened
// (run.js monarchsAt).
export function endScreen ({ run, opened = null, crowned = [], onNew, onDescend, onHelp }) {
  const s = run.state
  const asc = s.ascension ?? 0
  const won = s.result === 'victory'
  const lost = s.death
  const descend = canDescend(s)
  const deep = depthOf(s.floor)
  const n = TUNING.run.floors
  const cleared = Math.min(s.stats.floorsCleared, n)
  const deeper = s.stats.floorsCleared - cleared
  const tagline = descend ? 'The Hollow Sovereign falls, its court crumbles to dust with it, and its soul is yours. The run is cleared, and that stands whatever comes next.'
    : won ? `The Hollow Sovereign fell to you. Then, on floor ${s.floor}, ${deep} floor${deep === 1 ? '' : 's'} below it, the Monarch fell. The clear stands.`
      : `The Monarch fell on floor ${s.floor}, and the run with it.`
  const newRun = h('button', { class: descend ? 'ghost big' : 'primary big', onclick: onNew, tip: () => `Start again with a new seed. (${descend ? 'N' : 'Enter'})` },
    'New run ', h('kbd', null, descend ? 'N' : 'Enter'))
  const stat = endStat
  const views = [
    descend && { id: 'deep', name: 'The deep', body: () => [h('p', null, DEEP_TEXT.descend), h('p', { class: 'dim' }, DEEP_TEXT.growth), h('p', { class: 'warn' }, DEEP_TEXT.fall)] },
    lost && { id: 'death', name: 'What felled you', body: () => deathPanel(s, run.battle) },
    s.relics.length > 0 && { id: 'relics', name: 'Relics', body: () => [h('h2', null, 'Relics'), relicList(s.relics, run)] },
    { id: 'retinue', name: descend ? 'Your retinue' : 'Final retinue', body: () => h('div', { class: 'units' }, s.party.slice().sort(fieldOrder).map((u) => unitRow(run, u))) }].filter(Boolean)
  const tabs = h('div', { class: 'tabs end-tabs', role: 'tablist' })
  const panel = h('div', { class: 'panel end-panel', role: 'tabpanel' })
  const view = (id) => {
    hideTip()
    fill(tabs, views.map((v) => h('button', { class: 'tab' + (v.id === id ? ' on' : ''), role: 'tab', 'aria-selected': v.id === id ? 'true' : 'false', 'data-tab': v.id, onclick: () => view(v.id) }, v.name)))
    fill(panel, views.find((v) => v.id === id).body())
    panel.scrollTop = 0
  }
  view(views[0].id)
  const el = h('div', { class: `screen fit end-screen ${lost ? 'lost' : 'won'}` },
    h('div', { class: 'sting' }),
    h('div', { class: 'end-main' },
      h('div', { class: 'end-hero' },
        h('div', { class: 'sigil ' + (won ? 'win' : 'lose') }, icon(won ? 'boss' : 'elite', 46)),
        h('h1', { class: 'logo ' + (won ? 'win' : 'lose') }, descend ? 'VICTORY' : won ? 'CLEARED' : 'DEFEAT'),
        h('p', { class: 'tagline' }, tagline),
        // What the clear opened (main.js, run.js clearAt, monarchsAt), in one line: the level, its changes in its tip; a
        // Monarch, what it brings in its.
        unlocks(opened, crowned),
        h('div', { class: 'end-stats' },
          stat('stairs', 'monarch', deeper > 0 ? `${cleared}/${n} + ${deeper}` : `${cleared}/${n}`, 'floors', deeper > 0 ? `Floors cleared: ${cleared} of ${n}, and ${deeper} of the deep.` : `Floors cleared: ${cleared} of ${n}.`),
          stat('fight', 'foe', `${s.stats.wins}/${s.stats.fights}`, 'won', `Won ${s.stats.wins} of ${s.stats.fights} battle${s.stats.fights === 1 ? '' : 's'}.`),
          stat('hood', 'essence', s.stats.reaped, 'recruited', `Recruited ${s.stats.reaped} soul${s.stats.reaped === 1 ? '' : 's'}.`),
          stat('bone', 'ossuary', souls(s.party).length, 'souls', `${souls(s.party).length} souls at the end: ${ossuaryCount(run)}`),
          stat('soul', 'essence', s.stats.essence, 'essence', `Essence: ${s.stats.essence} earned, ${s.stats.spent} spent.`),
          stat('reliquary', 'relic', s.relics.length, 'relics', `Relics: ${s.relics.length} (${s.relics.filter(isRunRelic).length} run, ${s.relics.filter((id) => !isRunRelic(id)).length} held).`)),
        h('div', { class: 'title-actions end-actions' },
          descend && h('button', {
            class: 'primary big', onclick: onDescend,
            tip: () => `Go on to floor ${s.floor + 1}, the first of the deep, with your retinue, relics, essence and wounds as they are. The clear is already yours. (Enter)`
          }, 'Descend ', h('kbd', null, 'Enter')),
          newRun),
        h('p', { class: 'dim end-seed' }, `seed ${s.seed}`, asc > 0 && h('span', { tip: () => `Played at ascension ${asc}: ${ascensionText(asc).short}.` }, ` · ascension ${asc}`),
          s.monarch && h('span', { tip: () => MONARCHS[s.monarch].line }, ` · ${MONARCHS[s.monarch].name}`))),
      h('div', { class: 'end-detail' }, tabs, panel)),
    cornerButtons(onHelp))
  return {
    el,
    key (e) {
      if (descend && e.key === 'Enter') onDescend()
      else if (e.key === 'n' || e.key === 'N' || (!descend && e.key === 'Enter')) onNew()
    }
  }
}

// What a clear opened, for its end screen: the ascension above it (`opened`, or null) and the Monarchs (`crowned`), each
// named with its tip, in one line ("Ascension 1 is open, and the Brass Monarch is yours. Choose them on the title
// screen."); null for nothing.
function unlocks (opened, crowned) {
  const news = [
    opened !== null && h('span', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Ascension ${opened}`), ascensionText(opened).lines.map((l) => h('p', null, l)), h('p', { class: 'dim' }, ASCENSION_RULE)) },
      icon('levelup', 20), h('b', null, `Ascension ${opened} is open`)),
    ...crowned.map((id, n) => h('span', { tip: () => h('div', { class: 'syn-tip' }, h('b', null, MONARCHS[id].name), h('p', null, MONARCHS[id].line), monarchRules(MONARCHS[id])) },
      icon('crown', 20), h('b', null, `${MONARCHS[id].name.replace(/^The /, n === 0 && opened === null ? 'The ' : 'the ')} is yours`)))].filter(Boolean)
  if (!news.length) return null
  return h('p', { class: 'unlock' }, news.flatMap((x, i) => [i > 0 && (i === news.length - 1 ? ', and ' : ', '), x]),
    `. Choose ${news.length > 1 ? 'them' : 'it'} on the title screen.`)
}

// What felled the Monarch: who, with what, from where (a small board with both marked), and its threat. The
// battle's end replayed the same facts on the board itself (engine.js finish).
function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid && !d.tick ? s.death.from : null
  const walls = new Set(wallTiles(s.camp))
  // On its side as the battle draws it: their side on the left, your camp on the right, the top lane at the top.
  const at = (t) => [DEPTH - 1 - tileY(t) + 0.5, LANES - 1 - tileX(t) + 0.5]
  const cells = []
  for (let x = LANES - 1; x >= 0; x--) {
    for (let y = DEPTH - 1; y >= 0; y--) {
      const t = tileAt(x, y)
      cells.push(h('span', { class: 'db-cell' + (walls.has(t) ? ' wall' : '') + (t === mine ? ' me' : '') + (t === from ? ' killer' : '') },
        walls.has(t) ? h('img', { src: WALL_ART[t % WALL_ART.length], alt: '', draggable: 'false' })
          : t === from ? portrait(s.death.by, 30) : t === mine ? portrait('monarch', 30) : null))
    }
  }
  const zone = (cls, left, cols) => h('span', { class: 'db-zone ' + cls, style: `left:calc(var(--pad) + var(--c) * ${left});width:calc(var(--c) * ${cols})` })
  const strike = mine != null && from != null && (() => {
    const [[x1, y1], [x2, y2]] = [at(from), at(mine)]
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('class', 'db-strike')
    svg.setAttribute('viewBox', `0 0 ${DEPTH} ${LANES}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" vector-effect="non-scaling-stroke"/>`
    return svg
  })()
  return h('div', { class: 'death' },
    h('div', { class: 'death-text' },
      h('p', { class: 'death-head' }, d.head),
      d.lines.map((l) => h('p', { class: 'dim' }, l)),
      d.threat && h('p', { class: 'death-threat' }, 'Threat: ', h('b', null, d.threat.name), h('span', { class: 'dim' }, ` · ${d.threat.desc}`))),
    mine != null && h('div', {
      class: 'death-board',
      tip: () => from != null ? `The board as the blow landed: their side on the left, your camp on the right. The Monarch stood on ${tileText(mine)}; the killer struck from ${tileText(from)}.`
        : `The board as the battle ended: their side on the left, your camp on the right. The Monarch stood on ${tileText(mine)}.`
    },
    h('div', { class: 'db', style: `--lanes:${LANES};--depth:${DEPTH}` },
      zone('db-foe', 0, ROWS), zone('db-camp', DEPTH - CAMP_ROWS, CAMP_ROWS), cells, strike),
    h('div', { class: 'db-key' },
      h('span', { class: 'k-me' }, 'the Monarch'), from != null && h('span', { class: 'k-killer' }, unitDef(s.death.by).name))))
}

// The camp's walls, as the battle draws them (engine.js WALLS).
const WALL_ART = ['wall-0', 'wall-1', 'wall-2'].map((w) => new URL(`./assets/props/${w}.svg`, import.meta.url).href)

// A number of the end screen's tally (and the History's): its icon and value in its system's colour, its label under
// it, `name` its tip.
const endStat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name },
  h('span', { class: 'end-val' }, icon(ico, 22), h('b', null, v)), h('span', { class: 'lbl' }, label))

// ── history ──────────────────────────────────────────────────────────────────────────────────────

// The runs ended in this browser (redesign.md §4.8; sim/history.js), the newest first, beside their totals, laid out
// as the end screen is: the totals and Back in a column on the left, the runs on the right behind three tabs (every
// run, the clears, the dailies), each a line: how it ended and where, its level, its daily or its seed, when, the
// battles it won and how long it was played; the kinds it ended holding most (its fused kinds marked) and its kin;
// what felled the Monarch. Back (Escape, Enter) to the title. `day`: today's UTC day, for the daily's mark.
export function historyScreen ({ book, day, onBack, onHelp }) {
  const t = book.total
  const runs = book.runs
  const views = [
    { id: 'all', name: 'Every run', of: runs, none: 'No run has ended here yet. Every run you finish, clear or lose, or leave for a new one, is kept here: the last 100 of them, and the totals of all.' },
    { id: 'clears', name: 'Clears', of: runs.filter((e) => e.cleared), none: 'No clear kept yet: slay the Hollow Sovereign at the bottom of the last floor.' },
    { id: 'daily', name: 'Dailies', of: runs.filter((e) => e.daily), none: 'No daily kept yet. The title\'s Daily is the day\'s run, the same for everyone.' }]
  const tabs = h('div', { class: 'tabs end-tabs', role: 'tablist' })
  const panel = h('div', { class: 'panel end-panel hist-panel', role: 'tabpanel' })
  const view = (id) => {
    hideTip()
    fill(tabs, views.map((v) => h('button', { class: 'tab' + (v.id === id ? ' on' : ''), role: 'tab', 'aria-selected': v.id === id ? 'true' : 'false', 'data-tab': v.id, onclick: () => view(v.id) },
      v.name, h('span', { class: 'tab-n' }, v.of.length))))
    const v = views.find((x) => x.id === id)
    fill(panel, v.of.length ? h('div', { class: 'hist-runs' }, v.of.map((e) => runLine(e, day))) : h('p', { class: 'dim' }, v.none))
    panel.scrollTop = 0
  }
  view('all')
  const kept = t.runs > runs.length ? ` (the last ${runs.length} listed)` : ''
  const el = h('div', { class: 'screen fit end-screen history-screen' },
    h('div', { class: 'end-main' },
      h('div', { class: 'end-hero' },
        h('div', { class: 'sigil' }, icon('history', 46)),
        h('h1', { class: 'logo' }, 'HISTORY'),
        h('p', { class: 'tagline' }, t.runs ? `${t.runs} run${t.runs === 1 ? '' : 's'} ended in this browser${kept}.` : 'The runs you end are kept here.'),
        h('div', { class: 'end-stats hist-stats' },
          endStat('stairs', 'monarch', t.runs, 'runs', `Runs ended here: ${t.runs}, cleared, fallen or left.`),
          endStat('boss', 'essence', t.clears, 'clears', `Runs that slew the Hollow Sovereign: ${t.clears} of ${t.runs}${t.runs ? ` (${Math.round(100 * t.clears / t.runs)}%)` : ''}.`),
          endStat('levelup', 'warn', t.best >= 0 ? `A${t.best}` : '–', 'best clear', t.best >= 0 ? `The highest ascension cleared: ${t.best}.` : 'No ascension cleared yet.'),
          endStat('turn', 'plan', timeText(t.time, true), 'played', `Time played in the runs kept: ${timeText(t.time)}, the time between your moves (a pause of more than two minutes counted as two).`)),
        h('div', { class: 'title-actions end-actions' },
          h('button', { class: 'primary big', onclick: onBack, tip: () => 'Back to the title. (Esc)' }, 'Back ', h('kbd', null, 'Esc')))),
      h('div', { class: 'end-detail' }, tabs, panel)),
    cornerButtons(onHelp))
  return { el, key: (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === 'Backspace') onBack() } }
}

// A kept run's line (the History's): its mark (a crown for a clear, a skull for a fall, a step away for one left),
// how it ended, its level and its daily; when, its seed, its battles, its time; the souls it ended with; its killer.
function runLine (e, day) {
  const kind = (id) => { try { return unitDef(id) } catch { return null } }
  const kin = e.army.kin && KIN[e.army.kin]
  const army = e.army.kinds.filter((k) => kind(k.id))
  const by = e.fell?.by && kind(e.fell.by)
  const threat = e.fell?.threat && THREATS[e.fell.threat]
  const when = new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const daily = e.daily && h('span', { class: 'hist-daily' + (e.practice ? ' practice' : ''), tip: () => e.practice ? `A practice run of the daily of ${dayText(e.daily)}: the day's first attempt was made before it.` : `The daily of ${dayText(e.daily)}: the day's run, the same for everyone, and your first attempt of it.` },
    icon('daily', 16), e.daily === day ? 'Today\'s daily' : `Daily ${dayText(e.daily)}`, e.practice && ' (practice)')
  return h('div', { class: `hist-run ${e.end}${e.cleared ? ' won' : ''}` },
    h('span', { class: 'hist-mark', 'aria-hidden': 'true' }, icon(e.cleared ? 'boss' : e.end === 'left' ? 'release' : 'elite', 22)),
    h('div', { class: 'hist-main' },
      h('p', { class: 'hist-head' }, h('b', null, endText(e)), e.ascension > 0 && h('span', { class: 'hist-asc', tip: () => `Played at ascension ${e.ascension}: ${ascensionText(e.ascension).short}.` }, `A${e.ascension}`),
        MONARCHS[e.monarch] && h('span', { class: 'hist-mon', tip: () => `Played as ${MONARCHS[e.monarch].name}: ${MONARCHS[e.monarch].line}` }, icon('crown', 16), MONARCHS[e.monarch].name), daily),
      h('p', { class: 'hist-sub' }, [when, !e.daily && `seed ${e.seed}`, `${e.wins}/${e.fights} battle${e.fights === 1 ? '' : 's'} won`, timeText(e.time)].filter(Boolean).join(' · '))),
    army.length > 0 && h('div', {
      class: 'hist-army',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, 'The souls it ended with'),
        h('p', null, army.map((k) => `${kind(k.id).name}${k.n > 1 ? ` ×${k.n}` : ''}`).join(', '), ' held most', kin ? `; ${kin.name} the kin most held.` : '.'),
        e.army.fused.length > 0 && h('p', null, 'Fused: ', e.army.fused.filter(kind).map((id) => kind(id).name).join(', '), '.'))
    }, army.map((k) => h('span', { class: 'hist-kind' + (kind(k.id).fused ? ' fused' : '') }, portrait(k.id, 34), k.n > 1 && h('i', { class: 'count' }, `×${k.n}`))),
    kin && h('span', { class: 'hist-kin' }, kin.name)),
    e.fell && h('div', {
      class: 'hist-fell',
      tip: () => by ? `Felled by ${by.name}${threat ? ` · ${threat.name}: ${threat.desc}` : ''}` : 'The battle was lost with no one\'s blow.'
    }, by ? portrait(e.fell.by, 34) : icon('elite', 22), h('span', null, by ? by.name : 'Lost', threat && h('i', null, threat.name))))
}

// How a kept run ended, in words: "Cleared", "Cleared; fell in the deep, floor 5", "Fell on floor 2, room 6", "Left on
// floor 2, room 6".
export function endText (e) {
  const deep = depthOf(e.floor)
  const where = deep ? `in the deep, floor ${e.floor}` : `on floor ${e.floor}${e.room > 0 ? `, room ${e.room}` : ''}`
  if (e.cleared) return e.end === 'cleared' ? 'Cleared' : `Cleared; ${e.end === 'fell' ? 'fell' : 'left'} ${where}`
  return `${e.end === 'fell' ? 'Fell' : 'Left'} ${where}`
}
// A UTC day ('2026-10-15') as the player reads a date ("Oct 15"), in UTC.
const dayText = (day) => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
// A play time in words ("1 h 12 min", "41 min", "under a minute"); `short`, for a tile ("1h 12m", "41m").
function timeText (ms, short = false) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return short ? '0m' : 'under a minute'
  const [hr, min] = [Math.floor(m / 60), m % 60]
  if (short) return hr ? `${hr}h ${min}m` : `${min}m`
  return hr ? `${hr} h ${min} min` : `${min} min`
}

// ── the battle's chrome ──────────────────────────────────────────────────────────────────────────

// The battle keeps the Field's layout, so the board does not move as one fades into the other: a thin strip over the
// board (the room, the turn, the wave counter with the next wave's turn, the essence carried; no clock: redesign.md
// §2.10; sound and How to play at its end, as on the run's bar), and the slim panel beside it (redesign.md §4): the
// Monarch's HP, the selected piece's orders (its acts, each skill with its cooldown pip, Arise for a holder of its
// relic, Undo, Fuse), their synergies and yours (each with the rule it brings, live from the battle), the rules as they
// strike, and at its foot End Turn, always, then pause and skip, which change only how the playback is shown. The
// board takes the rest (stage: engine.js fits it there).
export function battleChrome ({ onHelp = null } = {}) {
  let scene = null
  let st = { paused: false, over: false, essence: 0, wave: 1, waves: 1, turn: 1, next: null, busy: true, panel: null }
  let carried = 0
  const noFocus = (e) => e.preventDefault()
  const btn = (attrs, ...kids) => h('button', { tabindex: '-1', onmousedown: noFocus, ...attrs }, ...kids)
  const pause = btn({ class: 'pause-btn', onclick: () => scene?.togglePause(), tip: () => 'Pause or resume the playback. (Space)' })
  const skip = btn({
    class: 'skip', 'data-sfx': 'none', onclick: () => scene?.skip(),
    tip: () => st.over ? 'On to what comes next. (S)' : 'Hurry the playback: what is playing shows at once. (S)'
  })
  // Names in a line, each kind once, ×n for more: "Grave Ghoul ×2, Bone Chanter"; and each its own: "the Tomb Knight and
  // the Bone Chanter".
  const group = (names) => {
    const m = new Map()
    for (const n of names) m.set(n, (m.get(n) ?? 0) + 1)
    return [...m].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ')
  }
  const count = h('b', null, '0')
  // The purse's card (engine.js tally, as the playback has shown the battle): what the foes slain so far carry, the
  // relics' share in, and the purse a win pays it into; what a win adds besides (an elite's bounty, Hollow Court's
  // shadows standing).
  const purseTip = () => {
    const t = scene?.tally()
    return h('div', { class: 'syn-tip' }, h('b', null, 'Essence'), t && [
      h('p', null, h('b', null, `+${t.owed}`), ` from ${t.slain} ${t.slain === 1 ? 'foe' : 'foes'} slain. A win adds it to your `, h('b', null, `${t.bank}`), '.'),
      t.bonus > 0 && h('p', null, `The elite pays +${t.bonus} more on a win.`),
      t.court && h('p', null, `Hollow Court: +${t.court.essence} more if ${t.court.n === 1 ? 'its shadow stands' : `its ${t.court.n} shadows stand`} at the win.`),
      t.gain !== 1 && h('p', { class: 'dim' }, `Your relics make each foe pay ×${+t.gain.toFixed(2)}, counted in.`)])
  }
  const purse = h('span', { class: 'purse', tip: purseTip }, icon('soul', 20), h('span', { class: 'purse-plus' }, '+'), count)
  const title = h('b', { class: 'bt-title' })
  // The panel's words: the Monarch's HP, their synergies and yours, a rule's name a moment as it strikes.
  const hpText = h('b', { class: 'bs-hp-n' })
  const hpFill = h('span')
  const crown = h('div', { class: 'bs-crown' },
    h('div', { class: 'bs-crown-top' }, h('span', { class: 'bs-name' }, icon('crown', 18), 'The Monarch'), hpText),
    h('div', { class: 'bs-hpbar' }, hpFill))
  const theirs = h('div', { class: 'bs-syns foe' })
  const mine = h('div', { class: 'bs-syns' })
  const theirRules = h('div', { class: 'bs-rules foe' })
  const myRules = h('div', { class: 'bs-rules' })
  // A side's synergies (codex.js synergyLabels): each its name and the rule it brings, the rule's text and the pieces it
  // counts (engine.js members) on hover.
  const list = (box, syns, foe = false) => fill(box, syns.length
    ? syns.map((x) => h('span', {
      class: 'bs-syn rule',
      tip: () => h('div', { class: 'syn-tip' }, h('b', null, `${x.name}: ${x.rule}`), ' ', foe ? theirText(x.text) : x.text, x.members && h('p', { class: 'dim' }, `Counted: ${x.members}.`))
    }, `${x.name} · `, h('b', null, x.rule)))
    : h('span', { class: 'dim' }, 'none'))
  const stage = h('div', { class: 'battle-stage' }, h('div', { class: 'pause-veil', 'aria-hidden': 'true' }, h('span', null, icon('pause', 26), 'Paused')))
  // The turn and the wave counter: counts, never a clock. On hover, as the playback has shown the battle: yours still to
  // act (while the board takes orders), the foes standing, and the next wave's size and turn (scouted).
  const turnN = h('b')
  const coming = () => (st.next ? `${st.next.size ? `${st.next.size} more` : 'more'} on turn ${st.next.turn}` : 'no more to come')
  const turnEl = h('span', {
    class: 'turn-n',
    tip: () => {
      const t = scene?.tally()
      const r = st.roster
      return h('div', { class: 'syn-tip' }, h('b', null, `Turn ${st.turn}`),
        st.over ? ' · the battle is over' : [r && ` · ${r.ready.length} of ${r.total} of yours still to act`, t && ` · ${t.foes} ${t.foes === 1 ? 'foe' : 'foes'} standing, ${coming()}`])
    }
  }, icon('turn', 18), turnN)
  const waveT = h('b')
  const waveNext = h('span', { class: 'dim' })
  const waveTurn = h('span', {
    class: 'wave-n',
    tip: () => h('div', { class: 'syn-tip' }, h('b', null, `Wave ${st.wave} of ${st.waves}`), ' ',
      !st.next ? 'No more come.'
        : st.next.size ? ['The next ', kw('wave'), `: ${st.next.size} ${st.next.size === 1 ? 'foe enters' : 'foes enter'} over the far edge as turn ${st.next.turn} begins.`]
          : ['The next ', kw('wave'), ` enters over the far edge as turn ${st.next.turn} begins.`])
  }, icon('wave', 18), waveT, waveNext)
  const selBox = h('div', { class: 'bs-sel' })
  // End Turn's card: what your side does as it is pressed (engine.js endInfo: the sim's own reckoning, on a copy), each
  // piece of yours still to act and what its basic does, in order; then the foes' turn, never what they will do.
  const laid = (list) => list.length > 0 && h('span', { class: 'dim' }, `, ${list.join(', ')}`)
  const endLine = (x) => h('li', null, x.name, x.shadow && h('span', { class: 'dim' }, ' (shadow)'),
    x.hexed ? h('span', { class: 'warn' }, ': Hexed, its act is lost')
      : [' → ', x.hits.length ? x.hits.map((t, i) => [i > 0 && '; ', t.name, t.n > 0 && h('b', { class: 'n-dmg' }, ` −${t.n}`), t.falls && h('b', { class: 'n-falls' }, ', falls'), laid(t.laid)])
        : x.heals.length ? x.heals.map((t, i) => [i > 0 && '; ', t.name, h('b', { class: 'n-heal' }, ` +${t.n}`), laid(t.laid)])
          : [x.target ?? x.act, x.missed && h('span', { class: 'dim' }, ': misses')]],
    x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back${x.fell ? ', falls' : ''}`),
    x.lost.length > 0 && h('span', { class: 'n-falls' }, ` · ${x.lost.join(', ')} ${x.lost.length === 1 ? 'falls' : 'fall'}`))
  const endTip = () => {
    const info = scene?.endInfo()
    const head = [h('b', null, 'End Turn'), say(' (E)', '')]
    if (st.over || !info) return h('div', { class: 'syn-tip' }, head, h('p', { class: 'dim' }, st.over ? 'The battle is over.' : 'The turn plays out…'))
    // Those with nothing to do are one line, after the rest, in order.
    const n = info.acts.length
    const idle = info.acts.filter((x) => !x.hexed && !x.act).map((x) => (x.shadow ? `${x.name} (shadow)` : x.name))
    return h('div', { class: 'syn-tip act-tip' }, head,
      n ? [h('p', null, `${n} still to act ${n === 1 ? 'uses its' : 'use their'} basic:`),
        h('ul', { class: 'act-targets' }, info.acts.filter((x) => x.hexed || x.act).map(endLine), idle.length > 0 && h('li', { class: 'dim' }, `Nothing in reach: ${group(idle)}`)),
        h('p', { class: 'dim' }, info.won ? 'The last foe falls: the battle is won.' : 'Then the foes\' turn.')]
        : h('p', null, 'All yours have acted. The foes\' turn next.'))
  }
  const endBtn = btn({ class: 'primary big end-turn', onclick: () => scene?.endTurn(), tip: endTip }, icon('play', 20), ' End Turn')
  const el = h('div', { class: 'battle-screen' },
    h('header', { class: 'battle-top' }, title, turnEl, waveTurn, h('span', { class: 'grow' }), purse,
      h('div', { class: 'top-btns' }, musicButton(), muteButton(),
        onHelp && btn({ class: 'icon-btn', 'aria-label': 'How to play', onclick: onHelp, tip: () => 'How to play: the battle waits while it is open. (H)' }, icon('help', 22)))),
    h('div', { class: 'battle-main' },
      stage,
      h('aside', { class: 'battle-panel' },
        crown,
        selBox,
        h('div', { class: 'bs-syn-box' },
          h('div', { class: 'bs-k foe' }, 'Their synergies'), theirs, theirRules,
          h('div', { class: 'bs-k' }, 'Yours'), mine, myRules),
        h('div', { class: 'bs-controls' }, endBtn, h('div', { class: 'bs-row' }, pause, skip)))))

  // The selected piece's orders (engine.js panel): its name, HP, Move left and the relic it holds; an act a button
  // (the armed one lit), a skill with its cooldown pip (lit: ready; dark: resting a turn), Arise among them for a
  // holder of its relic; Undo while its move may be undone. With none selected, how to begin.
  function selection () {
    const p = st.panel
    // With none selected: how many of yours may still act, and which (engine.js roster, read while the board takes orders).
    if (!p) {
      const r = st.roster
      return fill(selBox, h('p', { class: 'bs-hint dim' }, st.over ? 'The battle is over.' : st.busy || !r ? 'The turn plays out…'
        : r.ready.length ? [`${r.ready.length} of ${r.total} still to act: ${group(r.ready)}. `, say('Click', 'Tap'), ' one, or ', h('b', null, 'End Turn'), '.']
          : [!r.total ? 'None of yours takes orders: ' : r.total === 1 ? 'Yours has acted: ' : `All ${r.total} have acted: `, h('b', null, 'End Turn'), '.']))
    }
    const d = unitDef(p.id)
    const pip = (a) => a.skill && h('span', { class: 'cd-pip' + (a.rest > 0 ? ' rest' : ''), 'aria-label': a.rest > 0 ? 'resting' : 'ready' })
    // An act's card: what it does, with this piece's numbers (codex.js actText); how long it rests, as a skill; and what
    // it would do now to each it can take from here (the sim's preview, the same numbers aiming shows), or who only a
    // move first brings in reach.
    const turns = (n) => `${n} turn${n === 1 ? '' : 's'}`
    const target = (x) => h('li', null, x.self ? 'Itself' : x.name,
      x.by && h('span', { class: 'dim' }, `: the ${x.by} in the way takes it`),
      x.damage > 0 && h('b', { class: 'n-dmg' }, ` −${x.damage}`), x.falls && h('b', { class: 'n-falls' }, ' falls'),
      x.heal > 0 && h('b', { class: 'n-heal' }, ` +${x.heal}`), x.counter > 0 && h('span', { class: 'n-counter' }, ` · takes −${x.counter} back`))
    const actTip = (a) => () => {
      const info = scene?.actInfo(a.id)
      return h('div', { class: 'syn-tip act-tip' },
        h('b', null, a.name),
        a.skill && h('span', { class: 'dim' }, a.rest > 0 ? ` · ready in ${turns(a.rest)}` : a.rests > 0 ? ` · rests ${turns(a.rests)} after use` : ' · ready again next turn'),
        info && actText(info.a, info.st, info),
        !a.can ? (p.acted ? h('p', { class: 'warn' }, 'Already acted this turn.') : p.hexed ? h('p', { class: 'warn' }, 'Hexed: it cannot act this turn.')
          : a.rest > 0 ? null : h('p', { class: 'dim' }, a.heal ? 'No ally in reach needs it.' : 'Not usable now.'))
          : info?.now.length ? [h('p', { class: 'act-k' }, a.arise ? 'Corpses in reach:' : 'In reach now:'), h('ul', { class: 'act-targets' }, info.now.map(target))]
            : info?.later.length ? h('p', null, `Nothing in reach from here. Moving first brings in: ${group(info.later)}.`)
              : h('p', { class: 'dim' }, 'Nothing it can reach this turn.'))
    }
    const acts = p.acts.map((a) => btn({
      class: 'act-btn' + (a.armed ? ' armed' : '') + (a.skill ? ' skill' : '') + (a.arise ? ' arise' : ''), 'aria-pressed': a.armed ? 'true' : 'false',
      'aria-disabled': a.can ? null : 'true', onclick: () => a.can && scene?.arm(a.id), tip: actTip(a)
    }, pip(a), h('span', { class: 'act-name' }, a.name), h('span', { class: 'act-kind' }, a.skill ? 'skill' : 'basic')))
    const armed = p.acts.find((a) => a.armed)
    // The armed act with nothing to take from here: why (it rests, no ally needs it), and who a move brings in reach
    // (engine.js actInfo `later`), or that none would, or that it has no Move left.
    const moves = p.move > p.moved
    const later = !st.busy && armed?.can && !armed.targets ? scene?.actInfo(armed.id)?.later ?? [] : []
    const none = armed?.arise ? 'No corpse' : 'Nothing'
    const stuck = !armed || st.busy || armed.targets ? null
      : !armed.can ? (armed.rest > 0 ? `${armed.name} rests ${turns(armed.rest)} more.` : armed.heal ? `No ally in reach needs ${armed.name}.` : `${armed.name} cannot be used now.`)
        : later.length ? `${none} in reach of ${armed.name} from here: moving brings in ${group(later)}.`
          : moves ? `${none} in reach of ${armed.name} this turn, even after a move.` : `${none} in reach of ${armed.name} from here, and no Move left.`
    const line = p.hexed && !p.acted ? h('span', { class: 'warn' }, 'Hexed: it loses its act.')
      : p.acted ? h('span', { class: 'dim' }, 'Acted this turn.')
        : p.aim ? h('b', { class: 'aim-line' }, armed?.arise ? say('Click it again to raise it.', 'Tap it again to raise it.') : say('Click it again to strike.', 'Tap it again to strike.'),
          p.screen && [' ', h('span', { class: 'screened' }, 'Screened'), `: the ${p.screen} on its `, kw('line', 'line of fire'), ' takes it.'])
          : armed?.arise && armed.targets ? h('span', { class: 'dim' }, [say('Click', 'Tap'), ' a corpse ringed in green, again to raise it.'])
            : h('span', { class: 'dim' }, moves && armed?.targets ? [say('Click', 'Tap'), ' a lit tile to move, a ringed target to aim.']
              : armed?.targets ? [say('Click', 'Tap'), ' a ringed target to aim.']
                : [stuck, stuck && moves && ' ', moves && [say('Click', 'Tap'), ' a lit tile to move.']])
    fill(selBox,
      h('div', { class: 'sel-head' }, portrait(p.id, 38),
        h('div', { class: 'sel-id' },
          h('b', { class: 'sel-name' }, d.name),
          h('div', { class: 'sel-nums' },
            h('span', { class: 'sel-hp' }, hpBar(p.hp, p.maxHp), `${p.hp}/${p.maxHp}`),
            h('span', { class: 'sel-move', tip: () => `Move: ${p.move - p.moved} of ${p.move} tiles left this turn.` }, `Move ${Math.max(0, p.move - p.moved)}/${p.move}`)),
          p.relics.length > 0 && h('div', { class: 'sel-relic' }, p.relics.map((id) => h('span', { class: `rs-relic rt-${relicDef(id).tier}`, tip: () => relicTip(id) }, icon(relicIcon(id), 14), relicDef(id).name))))),
      acts.length > 0 && h('div', { class: 'sel-acts' }, acts),
      p.undo && h('div', { class: 'sel-acts' },
        btn({ class: 'undo-btn', onclick: () => scene?.undo(), tip: () => `Back to ${tileText(p.from)}, Move ${p.move}/${p.move} again. (U)` }, icon('undo', 18), 'Undo move')),
      h('div', { class: 'sel-line' }, line))
  }

  function render () {
    fill(pause, icon(st.paused ? 'play' : 'pause', 20), st.paused ? ' Resume' : ' Pause')
    fill(skip, icon('skip', 22), st.over ? ' Continue' : ' Skip', h('kbd', null, 'S'))
    el.classList.toggle('paused', st.paused && !st.over)
    el.classList.toggle('over', !!st.over)
    turnN.textContent = `Turn ${st.turn}`
    waveT.textContent = `${st.wave}/${st.waves}`
    waveNext.textContent = st.next ? ` · next on turn ${st.next.turn}` : ''
    waveTurn.hidden = st.waves < 2
    endBtn.setAttribute('aria-disabled', st.busy || st.paused || st.over ? 'true' : 'false')
    el.classList.toggle('busy', !!st.busy)
    selection()
    const e = st.essence ?? 0
    if (Math.round(e) !== Math.round(carried)) roll(count, carried, e, purse)
    carried = e
  }
  render()

  return {
    el,
    // Where the board goes, in viewport px.
    stage: () => stage.getBoundingClientRect(),
    hud: {
      start ({ title: t, monarch }) {
        title.textContent = t
        crown.hidden = !monarch
      },
      // Each side's synergies as the battle holds them now (engine.js changed: a fall or a rise may change
      // them mid-battle).
      synergies ({ theirs: th, mine: m }) {
        list(theirs, th, true)
        list(mine, m)
      },
      hp (hp, max) {
        const f = max ? Math.max(0, hp / max) : 0
        hpText.textContent = `${hp} / ${max}`
        hpFill.style.width = `${f * 100}%`
        crown.classList.toggle('low', f < 0.35)
      },
      announce (text, side) {
        const box = side ? myRules : theirRules
        const line = h('div', { class: 'bs-rule' }, text)
        box.append(line)
        while (box.children.length > 2) box.firstChild.remove()
        setTimeout(() => line.classList.add('out'), 1400)
        setTimeout(() => line.remove(), 1900)
      }
    },
    attach (s) { scene = s; s.purseAt = () => count.getBoundingClientRect() },
    update (next) { st = { ...st, ...next }; render() },
    key (e) {
      if (!scene) return
      // E ends the turn, U undoes the selected piece's move, Esc lets go of it (and skips nothing).
      if (e.code === 'KeyE') { e.preventDefault(); return scene.endTurn() }
      if (e.code === 'KeyU') { e.preventDefault(); return scene.undo() }
      if (e.code === 'Escape') { e.preventDefault(); return scene.select(null) }
      if (e.code === 'KeyS') { e.preventDefault(); return scene.skip() }
      if (e.code !== 'Space') return
      scene.togglePause()
      sfx.play('click')
      e.preventDefault()
    }
  }
}

// ── parts ────────────────────────────────────────────────────────────────────────────────────────

// Field first, front to back, then the ossuary.
const fieldOrder = (a, b) => (a.slot < 0) - (b.slot < 0) || a.slot - b.slot || a.uid - b.uid

// A soul in a list (the spoils' release list, the end screen): its name, level and tiers on one line; its HP, and
// that it is you or waits in the ossuary, on the next, then its kin, role and camp row.
function unitRow (run, u, extra = null) {
  const d = unitDef(u.id)
  const more = d.monarch ? 'you' : u.slot < 0 ? 'ossuary' : ''
  const kin = !d.monarch && `${KIN[d.kin].name} ${ROLES[d.role].name}${u.slot >= 0 ? ` · ${campRowLabel(rowOf(u.slot)).toLowerCase()}` : ''}`
  const tiers = (u.tracks ?? []).filter(Boolean)
  return h('div', { class: 'unit' + (u.hp <= 0 ? ' fallen' : '') + (d.monarch ? ' monarch' : ''), tip: () => unitCard(u, { mods: partyMods(run, u), realm: realmOf(run), run }) },
    h('span', { class: 'rank-port' + (d.monarch ? ' monarch' : '') + (u.hp <= 0 ? ' fallen' : '') }, portrait(u.id, 40)),
    h('div', { class: 'grow' },
      h('div', { class: 'u-name' }, h('b', null, d.name), !d.monarch && h('span', { class: 'dim' }, ` Lv ${u.lvl}`),
        tiers.length > 0 && h('span', { class: 'path-tag' }, ` tiers ${u.tracks.join('·')}`)),
      h('div', { class: 'line' }, hpBar(u.hp, u.maxHp), h('span', { class: 'dim' }, u.hp > 0 ? `${u.hp}/${u.maxHp}` : 'fallen', more && ` · ${more}`),
        kin && h('span', { class: 'dim u-kin' }, `· ${kin}`))),
    extra)
}

// The relics owned as chips, one per relic in its tier's colour (×N for copies; a trigger relic marked with a
// spark), grouped by tier; hover one for its rule, whether it is a run relic, and who holds it.
function relicList (ids, run = null) {
  if (!ids.length) return h('p', { class: 'dim small' }, 'None yet: the Shop sells them.')
  return h('div', { class: 'relics by-tier' }, relicsByTier(ids, ({ id, n }) =>
    h('span', { class: `relic rt-${relicDef(id).tier}` + (relicDef(id).on ? ' trig' : ''), tip: () => relicTip(id, run) },
      icon(relicIcon(id), 14), relicDef(id).name, n > 1 && h('span', { class: 'relic-n' }, `×${n}`))))
}
