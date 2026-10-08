# Handoff: RETINUE interface redesign

Written 2026-10-08 at the end of a long Claude Code session in VS Code on this Mac. Read this file first in any
new session, before touching code. It is for a fresh Claude Code session (driven from the Claude mobile app
through Remote Control) and for Chufan.

## 1. Driving this Mac from the Claude mobile app

Remote Control runs Claude Code on this Mac; the phone is a window into it. Files, tests and the browser all run
here.

**On the Mac, once:**
1. Install the Claude Code CLI if `claude` isn't on your PATH (the VS Code extension doesn't add it), and sign in
   with `/login` using your claude.ai account (Pro/Max/Team; API-key auth doesn't support Remote Control).
2. Keep the Mac awake and online while you work (System Settings → Battery/Energy → prevent sleep when the
   display is off, or run `caffeinate -dis` in a spare terminal).

**On the Mac, each time:**
```sh
cd ~/Documents/GitHub/TopDownShooter
claude remote-control        # server mode; press space for a QR code. See `claude remote-control --help`
                             # for --spawn options that let the phone open new sessions.
# or: claude --remote-control   (one interactive session, usable from the Mac and the phone)
# or, inside a running session: /remote-control
```

**On the phone:** Claude app → **Code** tab → the session with the computer icon and green dot (or scan the QR
code). Then send the starting message in section 2.

**Know before you go:**
- The `claude` process on the Mac must stay running; it reconnects by itself after sleep or a network drop.
- Permission prompts may need answering on the Mac. To avoid getting stuck away from the desk, start the
  session in a permission mode that doesn't prompt for routine edits and commands, the way this session ran.
- CLAUDE.md and the auto-memory in `~/.claude/projects/-Users-chufan2-Documents-GitHub-TopDownShooter/memory/`
  load automatically. The repo has no CLAUDE.md; this file stands in for one.
- Docs: https://code.claude.com/docs/en/remote-control

## 2. Message to paste on the phone to start

> Read HANDOFF.md in the repo root, then `git status` and `git diff --stat`. Summarise where the interface
> redesign stands and what's open, and wait for my go before changing anything.

## 3. The project in one paragraph

RETINUE is a browser necromancer autobattler: plain ES modules, no build step, Phaser 3 vendored at
`src/vendor/phaser.js`. `node serve.js [port]` serves it (default 5173); `npm test` runs the rule simulation
(238 tests, about 25 s). The rules live in `src/sim/*`, `src/tuning.js` and `src/content.js`; the interface in
`src/ui.js`, `src/codex.js`, `src/engine.js`, `src/board.js` and the CSS. `reDESIGN.md` is the rules design
and the balance record.

## 4. Standing decisions (also in auto-memory; don't relitigate)

- **Interface only.** Simplify the interface, never the rules. No changes to `src/sim/*` or `src/tuning.js`;
  in `src/content.js` only the presentation colour `DETACHMENT_COLORS` changed.
- **Modular tabs.** One view at a time behind tabs, never every panel at once.
- **Desktop only.** Minimum 1024×768, mouse and keyboard. Phone support was removed on purpose: no narrow
  media queries, touch modes or bottom sheets. Test at 1440×900, 1280×720 and 1024×768.
- **Enemy behaviour is discovered, never previewed.** No intent markers or "it will flank" text; roles may be
  hinted in flavour text.
- **Defeat is absolute.** Never suggest lives or retries.
- **Floor 1 is hard, and balance comes at the end.** No tuning passes now.

## 5. Where the work stands

**Uncommitted.** The whole redesign sits in the working tree on `master`, about 2,700 lines added and 1,300
removed across 8 files, plus new files. Nothing is committed past `7799143` (the first tab pass). Commit it on
a branch before anything risky. Never use `git stash`, `checkout` or `reset` on this tree.

**What changed, by area:**

| Area | Where | What |
|---|---|---|
| Prep on the battlefield | `src/board.js` (new), the board region of `retinueEditor` in `src/ui.js`, `src/css/board.css` | The army is arranged on the Phaser battle board itself. Drag to move; drag onto a unit to swap; click selects, and click on an empty tile moves the selection. Keyboard: Tab, arrows, Enter, X swaps, Shift+Enter picks. While dragging, the domain glows and falter previews show. Begin glides into the battle from the same picture. |
| Tray tabs | `tabBar` and the tray part of `render()` in `src/ui.js`, `src/css/card.css` | Soul · Monarch · Orders · Bones · Bonus, one row, icons plus badges. The idle Soul tab is a "what can I buy" summary. |
| Unit and Monarch cards | `soulCard`, `upgradePanel`, `rankPanel`, `cohortPanel`, `monarchPanel` in `src/ui.js` | Rank-framed card, stat icons, Bloons-style tier tracks, a cohort strip, the Monarch as a gold card. |
| Spoils, title and end | `reapScreen`, `endScreen`, `titleScreen` in `src/ui.js`, `src/css/spoils.css` | Card picks in steps (Recruit · Relic · Keystone · Path · Bind). Keys 1–9, 0, Q…; binds on ⇧+digit and ⇧Q…; B binds all free; S moves on. Relics and bodies fly to the top bar. |
| Feel and sound | `src/sfx.js` (new, Web Audio synth), the battle FX in `src/engine.js`, `topbar` and `battleBar` in `src/ui.js`, `src/css/feel.css` | Sounds and a mute (M), rolling counters, essence orbs, hit-stop, screen fades. Reduced motion is honoured everywhere. |
| Text and keywords | `src/keywords.js` (new; `kw(id)` makes a coloured keyword with a one-line hover), `src/codex.js`, `src/css/text.css` | Unit tooltips are 3 rows; Shift shows the details. How to play is a primer plus a searchable glossary. Rule texts were checked against the code. |
| Colour system | The `:root` tokens in `src/style.css`, documented there; `palette()` and `TOKENS` in `src/engine.js` | One colour per system. The canvas reads the CSS tokens. The closest system pair is 20.3 ΔE2000. |

**How it was built:** five parallel subagents per round, each owning named files and functions (Edit-tool
only on shared files), then read-only verifier agents. That ran for three rounds. The final verifiers found no
blockers: 0 page errors over about 640 battles, and flat memory and listener counts.

## 6. Open items

1. **The final desktop regression check passed on stability:** 11 full runs and 346 battles at 1440×900 and
   1024×768, with 0 page or console errors and flat scene, listener and memory counts. It confirmed 20 of the
   last round's 24 fixes. Still open from it:
   - **Medium:** at 1024×768 the board's zoom is 0.54, so level pills, ×0.7 falter tags, ◆ and head tags
     render at about 5–6 px. They don't go through `legible()` the way the labels do (`board.js` ~466–482).
   - **Low:** a front soul's level pill and ⇈ cover the Knight or Marshal badge of the soul behind it
     (`board.js` ~471 against ~531). A held soul's head tag overlaps its own flag. The detachment head tag
     ("1 → · STRUCK") is 5–7 px.
   - **Low:** "DOMAIN · 3" can hide the level pill on the domain's top-left tile at small zoom
     (`board.js` ~288).
   - **Low:** after pressing X on the board with nothing selected, "Select a soul first…" stays through
     Escape and tab switches (`ui.js` ~2480).
   - **Low:** How to play's Controls doesn't list ← → between spoils steps, or Enter and N on the end screen
     (`codex.js` ~862). The Synergy keyword could note that the pacts need a kin and a role together.
   - **Low:** the white banner and the Knight ring colour are only 14.5 ΔE apart. The comment in `style.css`
     claiming 19+ ignores the rank colours.
   - **Cleanup:** about 57 CSS classes the JS no longer sets (old DOM board and panel rules) and 3 unused
     names in `ui.js` (`campRowText`, `monarchPointText`, `inView`).
   - The Approach keyword was false (ranged foes do most of the Monarch's damage); it was fixed after the
     check.
2. **Decision for Chufan:** spoils now show offer groups as steps even in an ordinary fight (Recruit then
   Bind), which costs binding an extra click or B. The option is to show two-group rooms all at once and keep
   steps for elites. It's a one-line change in `reapScreen`.
3. **Known leftovers (small):**
   - map room tooltips are still 7–10 lines (formation picture plus threat);
   - an elite's bind step scrolls a little at 1280×720 and 1024×768;
   - banner and detachment colours sit about 19 ΔE from the nearest system colour;
   - the old `.cell` grid rules in `style.css` may be dead now that the board is a canvas.
4. **Commit.** Review `git diff`, then commit on a branch (for example `ui-redesign`) and open a PR if wanted.
   End commit messages with the Co-Authored-By line Claude Code supplies.
5. **The README** describes the game, not the interface. Update it only if asked.

## 7. How to test in a browser (the recipe this session used)

Install Playwright into a scratch folder outside the repo (`npm i playwright`) and drive the installed Chrome
rather than downloading Playwright's browsers:
```js
import { chromium } from 'playwright'
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1440, height: 900 } })
p.on('pageerror', (e) => console.log('ERR', e.message))
await p.goto('http://localhost:5199/?seed=demo')   // after: node serve.js 5199 &
```
- **Keys:** Enter starts a run, a digit enters a room, Enter begins a battle, S skips it.
- **Inspect state:** `window.retinue.run.state` in `page.evaluate`. Tamper with it from test scripts only,
  never in code.
- **Canvas:** the prep board is a canvas, so hover and drag by mouse position. `board.rectOf(tile)` (exported
  from `src/board.js`; import it in `page.evaluate` with `await import('/src/board.js')`) gives a tile's
  screen rect.
- **Stop the server** when done.
- The old session's scripts and screenshots were in `/private/tmp/claude-502/...` and are probably gone.
