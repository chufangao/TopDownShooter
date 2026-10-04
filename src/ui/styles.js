// The overlay's stylesheet, as a string injected once.
//
// A `.css` file would be tidier to read and would couple `src/ui/` to the bundler — these modules
// have to stay importable by `node --test`, which knows nothing about CSS imports. One template
// literal keeps the UI layer as plain JS as the sim layer is.

export const CSS = `
#ui {
  position: fixed; inset: 0; pointer-events: none; z-index: 10;
  font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: #cfc9bd;
}
#ui * { box-sizing: border-box; }
#ui button, #ui select, #ui input { font: inherit; color: inherit; }

/* the tab that is always visible — the only thing on screen before you open anything */
#ui .opener {
  position: absolute; top: 10px; right: 12px; pointer-events: auto;
  background: #12101b; border: 1px solid #2c2740; color: #cfc9bd;
  padding: 5px 11px; cursor: pointer; letter-spacing: .06em;
}
#ui .opener:hover { border-color: #e8b04b; color: #e8b04b; }
#ui .opener .dot { color: #e8b04b; margin-left: 7px; }
#ui .opener .count { color: #6e6a63; margin-left: 8px; }

/* the second opener, for the shop. Sits under the Doctrine tab rather than beside it, because they
   are different kinds of thing: one edits what you have, the other decides what you have. */
#ui .shop-opener { top: 44px; }
#ui .panel.shop { width: min(560px, 100vw); }

/* the Codex purse, and the shelves under it */
#ui .purse {
  display: flex; align-items: baseline; gap: 8px; border: 1px solid #2c2740; background: #100e19;
  padding: 8px 12px; margin-bottom: 14px; color: #6e6a63;
}
#ui .purse .big { color: #e8b04b; font-size: 17px; }
#ui .purse .grow { flex: 1; }
#ui h3.section { font-size: 11px; color: #cfc9bd; letter-spacing: .14em; margin: 18px 0 2px; font-weight: normal; }
#ui .section-blurb { margin: 0 0 8px; }

#ui .tenet {
  display: grid; grid-template-columns: 46px 1fr; gap: 9px; align-items: start;
  border: 1px solid #221f33; background: #100e19; padding: 7px 9px; margin-bottom: 5px;
}
#ui .tenet.held { border-color: #2f4436; background: #0e1410; }
#ui .tenet.blocked { opacity: .5; }
#ui .tenet.short { opacity: .72; }
#ui .tenet .nm { color: #cfc9bd; }
#ui .tenet .why { color: #6e6a63; font-style: normal; }
#ui .tenet .why.blocked { color: #8a6b3a; }
#ui .tenet .buy {
  background: #15131f; border: 1px solid #2c2740; color: #e8b04b; cursor: pointer;
  padding: 4px 0; width: 100%; letter-spacing: .04em;
}
#ui .tenet.ready .buy { border-color: #4a6b4a; color: #7be0a0; }
#ui .tenet.ready .buy:hover { background: #16241a; }
#ui .tenet .buy:disabled { color: #55525c; border-color: #221f33; cursor: default; }
#ui .tenet.held .buy { color: #7be0a0; border-color: #2f4436; }

/* a standing order — shown so the player can see what a bought rule pre-empts, never editable */
#ui .rule.standing { opacity: .72; border-style: dashed; }
#ui .rule.standing .ord { color: #55525c; }

/* ── the dispatch feed (§4.1) ──────────────────────────────────────────────────────────────────
   Bottom-left, over the canvas, never over the party. It does not block: the walk continues behind
   it, nothing is dimmed, and the only thing it takes from the player is a glance. */
#ui .dispatches {
  /* Clear of the HUD's own line at the bottom of the canvas, and capped so a tall stack scrolls
     inside itself rather than growing up over the party. */
  position: absolute; left: 12px; bottom: 30px; width: min(430px, calc(100vw - 24px));
  max-height: calc(100vh - 120px); overflow-y: auto;
  display: flex; flex-direction: column; gap: 8px; pointer-events: none;
}
#ui .card {
  pointer-events: auto; background: #0d0c14f2; border: 1px solid #2c2740;
  border-left: 2px solid #e8b04b; padding: 9px 11px 8px; backdrop-filter: blur(3px);
  animation: precedent-in .22s ease-out;
}
@keyframes precedent-in { from { opacity: 0; transform: translateY(6px); } }
#ui .card .chead { display: flex; gap: 8px; align-items: baseline; }
#ui .card .chead .tag { color: #e8b04b; letter-spacing: .14em; font-size: 10px; }
#ui .card .chead .where { color: #55525c; font-size: 10px; margin-left: auto; }
#ui .card h3 { font-size: 12px; color: #cfc9bd; margin: 5px 0 3px; font-weight: normal; letter-spacing: .04em; }
#ui .card p.cbody { color: #8a8595; margin: 0 0 8px; }

/* one accent per topic, so a glance says what kind of thing happened without reading it */
#ui .card.topic-combat { border-left-color: #d05c5c; }
#ui .card.topic-party { border-left-color: #7be0a0; }
#ui .card.topic-route { border-left-color: #4bc0e8; }
#ui .card.topic-run { border-left-color: #e8b04b; }
#ui .card .cfoot { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
#ui .card .cfoot .grow { flex: 1; }
#ui .receipt {
  display: flex; gap: 8px; align-items: baseline;
  background: #0d0c14f2; border: 1px solid #2f4436; border-left: 2px solid #7be0a0;
  padding: 5px 10px; color: #7be0a0; margin-bottom: 10px;
}
#ui .receipt.bad { border-color: #4a2626; border-left-color: #e06c6c; color: #e06c6c; }
#ui .receipt span { flex: 1; }
#ui .more-cards { pointer-events: none; color: #55525c; padding-left: 2px; font-size: 10px; }
#ui button.link {
  background: none; border: none; color: #6e6a63; cursor: pointer; padding: 0 2px;
  text-decoration: underline; text-underline-offset: 2px;
}
#ui button.link:hover { color: #e8b04b; }
#ui button.link.dim { text-decoration: none; }

/* run 1: an explanation, and no menu at all (§4.2) */
#ui .empty { max-width: 62ch; padding-top: 8px; }

#ui .panel {
  position: absolute; top: 0; right: 0; bottom: 0; width: min(730px, 100vw);
  pointer-events: auto; background: #0d0c14ee; border-left: 1px solid #2c2740;
  display: flex; flex-direction: column; backdrop-filter: blur(3px);
}
#ui .panel[hidden] { display: none; }

#ui .tabs { display: flex; gap: 2px; padding: 10px 12px 0; border-bottom: 1px solid #2c2740; }
#ui .tabs button {
  background: none; border: 1px solid transparent; border-bottom: none;
  padding: 6px 12px; cursor: pointer; color: #6e6a63; letter-spacing: .06em;
}
#ui .tabs button:hover { color: #cfc9bd; }
#ui .tabs button[aria-selected="true"] { color: #e8b04b; border-color: #2c2740; background: #15131f; }
#ui .tabs .spacer { flex: 1; }
#ui .tabs .close { color: #6e6a63; }

#ui .body { flex: 1; overflow-y: auto; padding: 14px 16px 24px; }
#ui .foot {
  border-top: 1px solid #2c2740; padding: 9px 12px; display: flex; gap: 8px; align-items: center;
  background: #0b0a11;
}
/* display:flex beats the hidden attribute, so it needs saying twice — the run-1 panel hides this
   whole bar rather than showing two greyed buttons. (No backticks in here: this file is one
   template literal, and a stray one ends it.) */
#ui .foot[hidden] { display: none; }
#ui .foot .grow { flex: 1; }
#ui .foot .note { color: #6e6a63; }
#ui .foot .note.warn { color: #e8b04b; }
#ui .foot .note.err { color: #e06c6c; }

#ui button.act {
  background: #15131f; border: 1px solid #2c2740; padding: 5px 12px; cursor: pointer;
}
#ui button.act:hover:not(:disabled) { border-color: #e8b04b; color: #e8b04b; }
#ui button.act:disabled { opacity: .35; cursor: default; }
#ui button.act.primary { border-color: #4a6b4a; color: #7be0a0; }
#ui button.act.primary:hover:not(:disabled) { background: #16241a; }

#ui h2 { font-size: 12px; color: #e8b04b; margin: 0 0 4px; letter-spacing: .1em; font-weight: normal; }
#ui p.lede { color: #6e6a63; margin: 0 0 14px; max-width: 60ch; }

/* a rule is a row; expressions are inline chips (§4.1) */
#ui .rule {
  border: 1px solid #221f33; background: #100e19; margin-bottom: 8px;
  display: grid; grid-template-columns: 30px 1fr; align-items: stretch;
}
#ui .rule.unreachable { opacity: .55; border-style: dashed; }
#ui .rule .ord {
  background: #15131f; border-right: 1px solid #221f33; color: #6e6a63;
  display: flex; align-items: center; justify-content: center;
}
#ui .rule .main { padding: 8px 10px; min-width: 0; }
#ui .rule .line { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
#ui .rule .kw { color: #6e6a63; letter-spacing: .08em; }
#ui .rule .tools { display: flex; gap: 4px; margin-left: auto; }
#ui .rule .tools button {
  background: none; border: 1px solid #221f33; color: #6e6a63; cursor: pointer;
  width: 22px; height: 20px; line-height: 1; padding: 0;
}
#ui .rule .tools button:hover { color: #e8b04b; border-color: #e8b04b; }
#ui .rule .why { color: #55525c; margin-top: 5px; font-style: italic; }

/* chips — every dropdown here is generated from a form's registered signature */
#ui select.chip, #ui input.chip {
  background: #1a1729; border: 1px solid #302a45; color: #cfc9bd;
  padding: 1px 3px; max-width: 15ch; text-overflow: ellipsis;
}
#ui select.chip.narrow { max-width: 8ch; }
#ui select.chip:hover, #ui input.chip:hover { border-color: #5a4f7d; }
#ui input.chip { width: 6ch; }
#ui input.chip.wide { width: 14ch; }
#ui input.chip[type="range"] { width: 84px; padding: 0; accent-color: #e8b04b; }
#ui .expr { display: inline-flex; flex-wrap: wrap; gap: 3px; align-items: center; }
#ui .expr .paren { color: #55525c; padding: 0 1px; }
#ui .expr .rows {
  display: flex; flex-direction: column; gap: 3px; align-items: flex-start;
  border-left: 1px solid #221f33; padding-left: 7px; margin: 1px 0;
}
#ui .expr .more {
  background: none; border: 1px dashed #302a45; color: #6e6a63; cursor: pointer; padding: 0 5px;
}
#ui .expr .more:hover { color: #e8b04b; border-color: #e8b04b; }

/* the fire count — a rule that never fires is otherwise completely invisible (§4.1) */
#ui .badge {
  border: 1px solid #221f33; background: #15131f; color: #6e6a63;
  padding: 0 6px; cursor: pointer; white-space: nowrap;
}
#ui .badge:hover { border-color: #cfc9bd; }
#ui .badge.hot { color: #7be0a0; border-color: #2f4436; }
#ui .badge.cold { color: #e8b04b; border-color: #4a3f22; }
#ui .trace {
  margin-top: 6px; border-left: 2px solid #302a45; padding: 6px 0 6px 9px;
  color: #8a8595; white-space: pre-wrap;
}
#ui .trace .head { color: #6e6a63; }
#ui .trace .no { color: #e06c6c; }
#ui .trace .yes { color: #7be0a0; }

#ui .problems { margin: 10px 0 0; padding: 8px 10px; border: 1px solid #4a2626; background: #1a1015; }
#ui .problems div { color: #e06c6c; }
#ui .problems div.warn { color: #e8b04b; }

/* the 3×4 formation grid (§3) — row labels down the left, four slots across */
#ui .grid {
  display: grid; grid-template-columns: 15ch repeat(4, 1fr); gap: 5px; align-items: stretch;
  margin-bottom: 6px;
}
#ui .grid .rowlabel {
  display: flex; flex-direction: column; justify-content: center;
  color: #6e6a63; letter-spacing: .08em; padding-right: 6px;
}
#ui .grid .rowlabel .why { font-style: normal; color: #55525c; letter-spacing: 0; line-height: 1.3; }
#ui .slot {
  border: 1px solid #221f33; background: #0e0c16; min-height: 46px; padding: 4px 6px;
  position: relative; display: flex; flex-direction: column; justify-content: center;
}
#ui .slot .why { font-style: normal; }
#ui .slot.filled { background: #15131f; border-color: #302a45; cursor: grab; }
#ui .slot.filled:hover { border-color: #5a4f7d; }
#ui .slot.pinned { border-color: #e8b04b; }
#ui .slot.over { border-color: #7be0a0; background: #16241a; }
#ui .slot.down { opacity: .45; }
#ui .slot .nm { color: #cfc9bd; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ui .slot .pin { position: absolute; top: 2px; right: 3px; font-size: 9px; }

#ui .strip { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }

/* one node type per row, columns aligned so the notes read as a column and not as a sentence */
#ui .noderow {
  display: grid; grid-template-columns: 11ch 7ch 16px 5ch 1fr; gap: 7px;
  align-items: center; margin-bottom: 5px;
}
#ui .noderow .why { font-style: normal; }
#ui .walk { margin-bottom: 14px; line-height: 1.7; }
#ui .strip .n { color: #55525c; width: 2ch; text-align: right; }
#ui textarea.share {
  width: 100%; height: 190px; background: #100e19; border: 1px solid #302a45;
  color: #cfc9bd; padding: 8px; resize: vertical; font: inherit;
}
#ui .hint { color: #55525c; margin-top: 8px; }
`

let injected = false

export function injectStyles (doc = document) {
  if (injected) return
  doc.head.appendChild(Object.assign(doc.createElement('style'), { textContent: CSS }))
  injected = true
}
