// The title: a new run, the run saved, the tutorial, the History, the ascension's and the Monarch's choosers; and the
// two overlays put up over a screen (askOverlay, tutorialCard).
import { ascensionText, ASCENSION_RULE } from '../codex.js'
import { MONARCHS, MONARCH_LIST } from '../content.js'
import { h, fill, icon, say } from '../dom.js'
import { kw } from '../keywords.js'
import { sfx } from '../sfx.js'
import { RANKS } from '../sim/map.js'
import { depthOf, ascensionTop } from '../sim/run.js'
import { TUNING } from '../tuning.js'
import { cornerButtons } from './chrome.js'
import { monarchRules } from './parts.js'

// ── title ────────────────────────────────────────────────────────────────────────────────────────

// `level`: the ascension the run will be played at, `open` the highest the player may choose, `onLevel(level)` each
// step of its chooser. `saved`, `note`: the run saved, a note over the foot. `monarch`, `monarchs`, `onMonarch`,
// `overlay`: the Monarch played as, those open, each choice heard, and how the picker is put up.
export function titleScreen ({
  seed, level = 0, open = 0, onLevel = () => {}, onStart, onHelp, saved = null, note = '', onContinue = null, onTutorial = null,
  onHistory = null, monarch = MONARCH_LIST[0].id, monarchs = [MONARCH_LIST[0].id], onMonarch = () => {}, overlay = null
}) {
  const input = h('input', { value: seed, spellcheck: 'false', 'aria-label': 'seed' })
  const seedNow = () => input.value.trim() || seed
  const start = () => onStart(seedNow())
  const ascension = ascensionChooser({ level, open, onLevel })
  const resume = resumeActions({ saved, onContinue, onTutorial })
  const history = onHistory && historyAction(() => onHistory(seedNow()))
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
        resume.tutorial,
        history),
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

// The run saved, to Continue (Enter) in the tagline's place, and the tutorial's button. → { banner (null for none),
// tutorial, enter (Enter's press; null: a new run) }
function resumeActions ({ saved, onContinue, onTutorial }) {
  const banner = saved && onContinue && h('div', { class: 'saved-run' },
    h('button', {
      class: 'primary big continue', onclick: onContinue,
      tip: () => `Go on with your saved run where you left it: ${placeText(saved)}. A run is saved after every move you make. (Enter)`
    }, 'Continue ', h('kbd', null, 'Enter')),
    h('span', { class: 'cont-at' }, h('b', null, 'Your run waits'), ` · ${placeText(saved)}`))
  const tutorial = onTutorial && h('button', {
    class: 'ghost', onclick: onTutorial,
    tip: () => 'One battle before floor 1, one soul given you against one foe, and three short screens of text: the camp, the battle, the spoils. Never saved.'
  }, icon('codex', 22), ' Tutorial')
  return { banner: banner || null, tutorial, enter: banner ? onContinue : null }
}

function historyAction (onHistory) {
  return h('button', {
    class: 'ghost', onclick: onHistory,
    tip: () => 'Every run ended in this browser, cleared, fallen or left, the newest first: how far it went, at what level, the souls it ended with and what felled the Monarch, and the totals.'
  }, icon('history', 22), ' History')
}

// Where a saved run stands, in a line: "Floor 2, room 6 of 15 · in battle, turn 3".
const PHASE_AT = { draft: 'the draft', prep: 'entering a battle', reap: 'the spoils', altar: 'at an altar' }
export function placeText (at) {
  const deep = depthOf(at.floor)
  const floor = `Floor ${at.floor}${deep ? ` (deep ${deep})` : ''}`
  const room = at.room > 0 ? `, room ${at.room} of ${RANKS - 1}` : ''
  const what = at.phase === 'battle' ? `in battle, turn ${at.turn}` : PHASE_AT[at.phase]
  return `${floor}${room}${what ? ` · ${what}` : ''}`
}

// A question over the screen with two answers: `yes` does it, `no` (a tap outside, Escape) leaves things as they were;
// `lead`, the answer the primary button and Enter give. → the overlay.
export function askOverlay ({ title, text, yes, no, onYes, onNo, lead = 'no' }) {
  const el = h('div', { class: 'overlay', onclick: (e) => { if (e.target === el) onNo() } },
    h('div', { class: 'modal ask', role: 'alertdialog', 'aria-label': title },
      h('h2', { class: 'modal-title' }, title),
      h('p', { class: 'lede' }, text),
      h('div', { class: 'title-actions' },
        h('button', { class: `${lead === 'yes' ? 'primary' : 'ghost'} big`, onclick: onYes }, yes, lead === 'yes' && h('kbd', null, 'Enter')),
        h('button', { class: `${lead === 'no' ? 'primary' : 'ghost'} big`, onclick: onNo }, no, lead === 'no' && h('kbd', null, 'Enter')))))
  el.key = (e) => { if (e.key === 'Escape') onNo(); else if (e.key === 'Enter') (lead === 'yes' ? onYes : onNo)() }
  return el
}

// One of the tutorial's three screens, over whatever it explains; its one button (`onGo`) lets the player on. → the overlay.
export function tutorialCard ({ screen, step, of = 3, onGo }) {
  const el = h('div', { class: 'overlay tut' },
    h('div', { class: 'modal tut-card', role: 'dialog', 'aria-label': screen.title },
      h('div', { class: 'tut-head' }, h('h2', { class: 'modal-title' }, screen.title), h('span', { class: 'dim tut-step' }, `${step} of ${of}`)),
      screen.lines.map((t) => h('p', null, t)),
      h('div', { class: 'title-actions' }, h('button', { class: 'primary big', onclick: onGo }, `${screen.go} `, h('kbd', null, 'Enter')))))
  el.key = (e) => { if (e.key === 'Enter' || e.key === 'Escape') onGo() }
  return el
}

// The ascension's chooser: − and + step the level from 0 to `open`, heard by `onLevel`; `line`: what it changes.
// → { chooser, line }
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

// A button naming the Monarch played as, which puts up the picker (`overlay(el)`; null takes it down). → { chooser }
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

// A card a Monarch, those not `open` greyed with the clear that opens them; a tap on an open one chooses it. → the overlay
function monarchPicker ({ chosen, open, onPick, onClose }) {
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
