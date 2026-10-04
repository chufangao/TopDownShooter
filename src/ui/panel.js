// The Doctrine panel — as wide as what you bought, and no wider.
//
// Plain DOM over the canvas (§8), never a Phaser scene: these are forms over a JSON tree, and they
// want text inputs, focus and scrolling rather than sprites.
//
// > **Superseded twice, and the second time is the one that matters.** M3 shipped five editors
// > behind a `tab` key, all available on minute one — a settings screen for a game that plays
// > itself. M3.5 replaced that with six panels handed over by a Precedent that noticed you
// > struggling, which fixed the timing and made the deeper problem worse: the game was choosing
// > what you could do, and the unit it chose was a whole editor.
//
// What survives from both is the machinery — the chip editor, the validator, the fire counts, the
// expr trees, the export string, none of which changed. What is different is that every surface
// below is drawn from `store.capabilities()`, which is the sum of the tenets the player bought
// (§4.2). A field nothing was bought for is **absent**, a chip nothing granted is **not in the
// dropdown**, and a rule list is exactly as long as the slots that were paid for.
//
// So this panel is empty on run 1, and it grows only when somebody decides it should.
//
// One rule about time, and it is the §1 rule restated: **opening this panel holds the walk at the
// next node boundary, and edits go live at that same boundary.** Holding is a view control, like
// ×1–×8 — the sim has not decided anything past the node the party is standing on, so pausing the
// camera is not an input into the game. Applying at a boundary rather than immediately is what
// keeps §8's contract intact: a battle the sim has already resolved is played back exactly as it
// was resolved, and a rewritten rule is in force for the *next* fight.

import { el, clear } from './dom.js'
import { injectStyles } from './styles.js'
import * as formation from './editors/formation.js'
import * as targeting from './editors/targeting.js'
import * as ability from './editors/ability.js'
import * as recruit from './editors/recruit.js'
import * as route from './editors/route.js'
import * as succession from './editors/succession.js'
import * as share from './editors/share.js'

/**
 * Every editor that exists, keyed by the Doctrine field it edits — the same key a tenet names in
 * `grants.edit`. That one string is the entire binding between a purchase and its surface.
 */
const EDITORS = { formation, targeting, ability, recruit, route, branch: succession }

/**
 * Which Doctrine paths make each editor worth showing at all.
 *
 * A tab appears the moment any one of its paths has been bought, which is what lets *Pin a unit*
 * and *Role rows* be separate purchases that happen to share a screen. The alternative — a tab per
 * tenet — would put twenty tabs across the top, and the complaint that produced this design was
 * that the surfaces were too big, not that there were too few of them.
 */
const PANEL_PATHS = {
  formation: ['formation.pins', 'formation.autoRow'],
  targeting: ['targeting.default', 'targeting.byRole', 'allyTargeting.default'],
  ability: ['ability'],
  recruit: ['recruit', 'cut'],
  route: ['route.order', 'route.skip', 'route.maxNodes'],
  branch: ['branch']
}

const PANEL_TITLE = {
  formation: 'FORMATION', targeting: 'FOCUS', ability: 'ORDERS',
  recruit: 'PARLEY', route: 'ROUTE', branch: 'SUCCESSION'
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.mount
 * @param {object} opts.kernel
 * @param {object} opts.store
 * @param {() => object|null} opts.getRun   the live run, for its trace — read, never written
 * @param {(open: boolean) => void} [opts.onToggle]  told when to hold and release the walk
 */
export function createPanel ({ mount, kernel, tuning, store, getRun, onToggle = () => {} }) {
  injectStyles()

  let active = null
  let badges = []
  let open = false

  /**
   * The tabs this player actually has, derived from what they bought — every render, so a purchase
   * made thirty seconds ago is here without anything having been told about it.
   *
   * SHARE appears as soon as there is anything worth sharing, which is the first purchase.
   */
  function panels () {
    const cap = store.capabilities()
    const out = Object.entries(PANEL_PATHS)
      .filter(([, paths]) => paths.some((p) => cap.can(p)))
      .map(([id]) => ({ id, title: PANEL_TITLE[id], editor: EDITORS[id] }))
    if (out.length) out.push({ id: share.meta.id, title: share.meta.title, editor: share })
    return out
  }

  const opener = el('button', { class: 'opener', onclick: () => toggle() })
  const body = el('div', { class: 'body' })
  const tabs = el('div', { class: 'tabs' })
  const note = el('span', { class: 'note' })
  const apply = el('button', {
    class: 'act primary',
    text: 'apply at the next node',
    onclick: () => {
      if (!store.commit()) return
      paint()
    }
  })
  const revert = el('button', { class: 'act', text: 'revert', onclick: () => { store.revert(); rerender() } })
  const foot = el('div', { class: 'foot' }, [note, el('span', { class: 'grow' }), revert, apply])

  const panel = el('div', { class: 'panel', hidden: true }, [tabs, body, foot])

  mount.appendChild(opener)
  mount.appendChild(panel)

  // Tab opens and closes it. The key is chosen because it is not bound to anything in the game —
  // there is nothing in the game to bind it to.
  const onKey = (e) => {
    if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.target instanceof HTMLTextAreaElement) return
    e.preventDefault()
    toggle()
  }
  window.addEventListener('keydown', onKey)

  function toggle (next = !open) {
    open = next
    panel.hidden = !open
    if (open) rerender()
    paint()
    onToggle(open)
  }

  function rerender () {
    const available = panels()
    clear(body)
    clear(tabs)
    badges = []

    if (available.length === 0) {
      // ★ Run 1, and the whole of it. Nothing is greyed out here because nothing exists yet to
      // grey, and nothing on this screen tells the player what to want.
      body.appendChild(el('div', { class: 'empty' }, [
        el('h2', { text: 'NOTHING BOUGHT YET' }),
        el('p', { class: 'lede', text: 'The party is fighting by its standing orders and doing it without you — which is the game working, not the game waiting.' }),
        el('p', { class: 'lede', text: 'A run pays in Codex: the first kill of each boss, the first time each species is talked round, the first firing of each Pact. Spend it in the Codex list and this screen becomes as wide as what you bought — one narrow thing at a time, and only the things you chose.' }),
        el('p', { class: 'lede', text: 'Nothing here will unlock itself, and nothing will suggest what to buy.' })
      ]))
      tabs.appendChild(el('span', { class: 'spacer' }))
      tabs.appendChild(el('button', { class: 'close', text: 'CLOSE  ⇥', onclick: () => toggle(false) }))
      // No apply, no revert: there is nothing yet that either could act on, and a pair of greyed
      // buttons is a menu telling the player they are missing something. They are not.
      foot.hidden = true
      paint()
      return
    }
    foot.hidden = false

    if (!available.some((t) => t.id === active)) active = available[0].id
    const tab = available.find((t) => t.id === active)

    for (const t of available) {
      tabs.appendChild(el('button', {
        text: t.title,
        'aria-selected': String(t.id === active),
        onclick: () => { active = t.id; rerender() }
      }))
    }
    tabs.appendChild(el('span', { class: 'spacer' }))
    tabs.appendChild(el('button', { class: 'close', text: 'CLOSE  ⇥', onclick: () => toggle(false) }))

    const view = tab.editor.render({
      store,
      kernel,
      tuning,
      // Read-only handles. The editors show the live party and the live fire counts; §18.15 is what
      // stops them deciding anything with either.
      getRun,
      getTrace: () => getRun()?.trace ?? null,
      // ★ What the player bought, handed to the editor so it can draw exactly that much and no
      // more: which sections exist, how many rows, which chips are in the dropdown.
      cap: store.capabilities(),
      rerender
    })
    body.appendChild(view.root)
    badges = view.badges ?? []

    const problems = store.problems()
    if (problems.length) {
      const box = el('div', { class: 'problems' })
      for (const p of problems) box.appendChild(el('div', { class: p.severity === 'warn' ? 'warn' : '', text: `${p.path}: ${p.msg}` }))
      body.appendChild(box)
    }

    sync()
    paint()
  }

  /** Open a named panel — where a Precedent's receipt lands when the player follows it. */
  function show (panelId) {
    if (panels().some((t) => t.id === panelId)) active = panelId
    toggle(true)
  }

  /** Counters only — never a re-render, or an open dropdown would close under the player's hand. */
  function sync () { for (const b of badges) b.sync() }

  function paint () {
    const errors = store.errors().length
    const owned = store.owned().length
    opener.innerHTML = ''
    opener.appendChild(el('span', { text: 'DOCTRINE  ⇥' }))
    opener.appendChild(el('span', { class: 'count', text: owned ? `${owned} held` : 'nothing yet' }))
    if (store.dirty) opener.appendChild(el('span', { class: 'dot', text: errors ? '✕' : '●' }))
    opener.hidden = open

    apply.disabled = !store.dirty || errors > 0
    revert.disabled = !store.dirty
    note.className = 'note' + (errors ? ' err' : store.dirty ? ' warn' : '')
    note.textContent = errors
      ? `${errors} problem${errors > 1 ? 's' : ''} — fix before applying`
      : store.dirty
        ? 'edited — the run is still fighting by the applied version'
        : owned === 0 ? 'nothing to apply — the party has no policy of yours yet' : 'in force'
  }

  paint()
  const timer = setInterval(() => { if (open) sync() }, 500)

  // A purchase made while this is open adds a tab, so a commit rebuilds rather than repaints.
  // Everything else is a keystroke in the draft and only moves the footer.
  const unsubscribe = store.subscribe((what) => {
    if (what === 'commit' && open) rerender()
    else paint()
  })

  return {
    get open () { return open },
    toggle,
    show,
    rerender,
    destroy () {
      clearInterval(timer)
      unsubscribe()
      window.removeEventListener('keydown', onKey)
      mount.removeChild(opener)
      mount.removeChild(panel)
    }
  }
}
