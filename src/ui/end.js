// The end of a run (cleared, fallen after the clear, or defeated), and the History: the runs ended in this browser.
import { deathText, tileText, DEEP_TEXT, ascensionText, ASCENSION_RULE } from '../codex.js'
import { unitDef, KIN, THREATS, MONARCHS } from '../content.js'
import { h, fill, icon, portrait, hideTip } from '../dom.js'
import { souls, monarchOf, canDescend, depthOf, isRunRelic } from '../sim/run.js'
import { ROWS, CAMP_ROWS, LANES, DEPTH, tileAt, deployTile, wallTiles, tileX, tileY } from '../sim/unit.js'
import { TUNING } from '../tuning.js'
import { ossuaryCount, cornerButtons } from './chrome.js'
import { fieldOrder, unitRow, relicList, monarchRules } from './parts.js'

// ── end ──────────────────────────────────────────────────────────────────────────────────────────

// Three ends: the Sovereign slain (cleared, the deep below), a fall in the deep after the clear (the clear stands), a
// defeat. `opened`: the ascension the clear opened, or null; `crowned`: the Monarchs it opened.
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
        // What the clear opened, in one line, each with its tip.
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
            tip: () => `Go on to floor ${s.floor + 1}, the first of the deep, with your retinue, relics, essence and the Monarch's HP as they are. The clear is already yours. (Enter)`
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

// What a clear opened (`opened`, `crowned`), each named with its tip, in one line; null for nothing.
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

// What felled the Monarch: who, with what, from where (a small board with both marked), and its threat.
function deathPanel (s, battle) {
  const d = deathText(s, battle)
  const m = monarchOf(s)
  const mine = m.slot >= 0 ? deployTile('party', m.slot) : null
  const from = s.death.reason === 'monarch' && s.death.uid !== m.uid && !d.tick ? s.death.from : null
  // The battle's walls, the room's with the camp's (the camp's alone where no battle is kept).
  const walls = new Set(battle?.walls ?? wallTiles(s.camp))
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

// The camp's walls, as the battle draws them.
const WALL_ART = ['wall-0', 'wall-1', 'wall-2'].map((w) => new URL(`../assets/props/${w}.svg`, import.meta.url).href)

// A number of the end's tally (and the History's): icon and value in its system's colour, label under, `name` its tip.
const endStat = (ico, sys, v, label, name) => h('div', { class: 'end-stat', style: `--s:var(--c-${sys})`, tip: () => name },
  h('span', { class: 'end-val' }, icon(ico, 22), h('b', null, v)), h('span', { class: 'lbl' }, label))

// ── history ──────────────────────────────────────────────────────────────────────────────────────

// The runs ended in this browser, the newest first, beside their totals, laid out as the end screen is.
export function historyScreen ({ book, onBack, onHelp }) {
  const t = book.total
  const runs = book.runs
  const views = [
    { id: 'all', name: 'Every run', of: runs, none: 'No run has ended here yet. Every run you finish, clear or lose, or leave for a new one, is kept here: the last 100 of them, and the totals of all.' },
    { id: 'clears', name: 'Clears', of: runs.filter((e) => e.cleared), none: 'No clear kept yet: slay the Hollow Sovereign at the bottom of the last floor.' }]
  const tabs = h('div', { class: 'tabs end-tabs', role: 'tablist' })
  const panel = h('div', { class: 'panel end-panel hist-panel', role: 'tabpanel' })
  const view = (id) => {
    hideTip()
    fill(tabs, views.map((v) => h('button', { class: 'tab' + (v.id === id ? ' on' : ''), role: 'tab', 'aria-selected': v.id === id ? 'true' : 'false', 'data-tab': v.id, onclick: () => view(v.id) },
      v.name, h('span', { class: 'tab-n' }, v.of.length))))
    const v = views.find((x) => x.id === id)
    fill(panel, v.of.length ? h('div', { class: 'hist-runs' }, v.of.map(runLine)) : h('p', { class: 'dim' }, v.none))
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

// A kept run's line: its mark, how it ended and its level; when, its seed, its battles, its time; its souls; its killer.
function runLine (e) {
  const kind = (id) => { try { return unitDef(id) } catch { return null } }
  const kin = e.army.kin && KIN[e.army.kin]
  const army = e.army.kinds.filter((k) => kind(k.id))
  const by = e.fell?.by && kind(e.fell.by)
  const threat = e.fell?.threat && THREATS[e.fell.threat]
  const when = new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return h('div', { class: `hist-run ${e.end}${e.cleared ? ' won' : ''}` },
    h('span', { class: 'hist-mark', 'aria-hidden': 'true' }, icon(e.cleared ? 'boss' : e.end === 'left' ? 'release' : 'elite', 22)),
    h('div', { class: 'hist-main' },
      h('p', { class: 'hist-head' }, h('b', null, endText(e)), e.ascension > 0 && h('span', { class: 'hist-asc', tip: () => `Played at ascension ${e.ascension}: ${ascensionText(e.ascension).short}.` }, `A${e.ascension}`),
        MONARCHS[e.monarch] && h('span', { class: 'hist-mon', tip: () => `Played as ${MONARCHS[e.monarch].name}: ${MONARCHS[e.monarch].line}` }, icon('crown', 16), MONARCHS[e.monarch].name)),
      h('p', { class: 'hist-sub' }, [when, `seed ${e.seed}`, `${e.wins}/${e.fights} battle${e.fights === 1 ? '' : 's'} won`, timeText(e.time)].filter(Boolean).join(' · '))),
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

// How a kept run ended, in words: "Cleared", "Cleared; fell in the deep, floor 5", "Left on floor 2, room 6".
function endText (e) {
  const deep = depthOf(e.floor)
  const where = deep ? `in the deep, floor ${e.floor}` : `on floor ${e.floor}${e.room > 0 ? `, room ${e.room}` : ''}`
  if (e.cleared) return e.end === 'cleared' ? 'Cleared' : `Cleared; ${e.end === 'fell' ? 'fell' : 'left'} ${where}`
  return `${e.end === 'fell' ? 'Fell' : 'Left'} ${where}`
}
// A play time in words ("1 h 12 min", "41 min", "under a minute"); `short`, for a tile ("1h 12m", "41m").
function timeText (ms, short = false) {
  const m = Math.floor(ms / 60000)
  if (m < 1) return short ? '0m' : 'under a minute'
  const [hr, min] = [Math.floor(m / 60), m % 60]
  if (short) return hr ? `${hr}h ${min}m` : `${min}m`
  return hr ? `${hr} h ${min} min` : `${min} min`
}
