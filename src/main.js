// Entry point: load content, then start the renderer. Never the other way round.
//
// The registry is built and frozen before a Phaser Game exists (§11.1, invariant §18.8), and a
// content error is a readable panel rather than a blank canvas — the same failure policy the
// loader uses for a bad pack (§13.1).

import { createGame } from './sim/boot.js'
import { formatReport } from './sim/mods/loader.js'
import { createTrace } from './sim/trace.js'
import { bundledPacks } from './engine/packsource.browser.js'
import { startGame } from './engine/boot.js'
import { createDoctrineStore } from './ui/store.js'
import { createPanel } from './ui/panel.js'
import { createDispatchFeed } from './ui/dispatch.js'
import { createShop } from './ui/shop.js'

const seed = new URLSearchParams(location.search).get('seed') ?? 'retinue-0'

const packs = bundledPacks()
const { kernel, report, tuning } = await createGame({ packs, seed, log: (...a) => console.log(...a) })

console.log(formatReport(report))

if (report.errors.length) {
  fault('Content did not load', report)
} else {
  for (const w of report.warnings) console.warn(w)

  // This file is the composition root, and the only place the three layers meet. `ui/` never
  // imports `engine/` and `engine/` never imports `ui/`: the editor writes a Doctrine, the scene
  // reads one, and neither knows the other exists (§8).
  const store = createDoctrineStore({ kernel })
  const trace = createTrace()
  // The signal ledger belongs to the profile, not to a run (§4.3): a run is *handed* one so its
  // profile-scoped counters survive a wipe, which is what makes "typically learned run 2–3" a
  // statement the content can actually express.
  const sim = { kernel, tuning, packs, report, seed, doctrine: store.live, trace, signals: store.signals }

  const game = startGame('game', sim)
  const dungeon = () => game.scene.getScene('Dungeon')
  const ui = document.getElementById('ui')

  const panel = createPanel({
    mount: ui,
    kernel,
    tuning,
    store,
    getRun: () => dungeon()?.run ?? null,
    // Opening the panel holds the walk at the next node boundary. That is a view control like
    // ×1–×8, not an input into the game (§1) — the sim has decided nothing past the node the party
    // is standing on, so there is nothing to pause but the camera.
    onToggle: (open) => dungeon()?.hold(open)
  })

  // ★ Where the player finds out what happened (§4.1). Reports arrive from the run, already
  // resolved; nothing waits for them, and none of them says what to do about it.
  const dispatches = createDispatchFeed({ mount: ui, store })
  sim.onDispatches = (cards) => dispatches.push(cards)

  // ★ And where they decide what to be able to do about it (§4.2). The only thing in the game that
  // widens the Doctrine, and the player opens it themselves.
  const shop = createShop({ mount: ui, store, onBuy: () => panel.rerender() })
  // Codex accrues where §5 says it does: at the end of a run, from what that run was the first to
  // find. It is the only currency a losing run reliably produces, which is what makes a floor-2
  // wipe still worth something.
  sim.onDiscover = (keys) => store.discover(keys)

  store.subscribe((what) => {
    if (what !== 'commit') return
    sim.doctrine = store.live          // every future run starts from the applied version
    dungeon()?.adopt(store.live)       // the current one adopts it at its next node boundary
  })

  // A dev handle for poking at a live run from the console. Read-only by convention; the registry
  // is frozen, so the interesting half cannot be corrupted from here anyway.
  if (import.meta.env.DEV) {
    window.retinue = { game, kernel, tuning, report, seed, store, trace, panel, shop, dispatches, scene: dungeon }
  }
}

function fault (title, r) {
  const el = document.createElement('div')
  el.id = 'fault'
  el.innerHTML = `<h1>${title}</h1>`
  const add = (cls, text) => {
    const p = document.createElement('div')
    p.className = cls
    p.textContent = text
    el.appendChild(p)
  }
  for (const e of r.errors) add('e', 'ERROR  ' + e)
  for (const w of r.warnings) add('w', 'warn   ' + w)
  for (const d of r.disabled) add('w', `disabled ${d.id}: ${d.reason}`)
  add('', '\nFix the content and the page will reload.')
  document.body.appendChild(el)
}
