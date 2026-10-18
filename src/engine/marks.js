// A soul's marks, the same on the Field board and in battle: Arise's caption, a label placed clear of the units, a
// soul's tiers and relics under its bars.
import { relicDef } from '../content.js'
import { C, PATH_PIP, RELIC_TIER, INK, DISPLAY } from './palette.js'

// ── a soul's marks, shared with the Field board ──────────────────────────────────────────────────

export const BAR = 46
export const BAR_DROP = 14     // from the feet down to the HP bar, clear of the pictures' ground details
const PIP_SPAN = 78     // a soul's tiers stand within this width under its bars, inside its lane

// Arise's caption, "ARISE · 5" (its reach in tiles), on a dark plate; placed outside its box, never inside it.
export function domainLabel (scene, r) {
  return scene.add.text(0, 0, `ARISE · ${r}`,
    { fontFamily: DISPLAY, fontSize: '11px', fontStyle: 'bold', color: C.domain, backgroundColor: `${C.ink}e6`, padding: { x: 5, y: 2 } })
    .setResolution(3).setOrigin(0, 0)
}

// The area two world rects ({ l, r, t, b }) share.
export const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))

// Puts `t` (a top-left origin label) just outside the corner of `box` that covers least of `blocked` (world rects,
// `w` a rect's weight), inside `limit` where it can. → its rect.
export function placeOutside (t, box, limit, blocked = []) {
  const [w, h] = [t.displayWidth, t.displayHeight]
  const spots = [[box.l + 8, box.t - h - 3], [box.r - 8 - w, box.t - h - 3], [box.l + 8, box.b + 3], [box.r - 8 - w, box.b + 3]]
  let best = null
  for (const [x, y] of spots) {
    const r = { l: x, t: y, r: x + w, b: y + h }
    const out = (r.t < limit.t || r.b > limit.b || r.l < limit.l || r.r > limit.r) ? 1e7 : 0
    const cost = out + blocked.reduce((n, b) => n + overlap(r, b) * (b.w ?? 1), 0)
    if (!best || cost < best.cost - 1) best = { cost, x, y, r }
  }
  t.setPosition(best.x, best.y)
  return best.r
}

// A soul's growth: a diamond a tier under its bars (its first track's colour, then its second's) and a gem a relic
// held at its bar's right end. → { parts, place(x, y) }, placed every frame from the feet.
export function growthMarks (scene, u) {
  // Kept inside the unit's lane (PIP_SPAN wide): many tiers stand closer, overlapping like a chain.
  const pips = scene.add.container(0, 0)
  const [t1, t2] = u.tracks ?? [0, 0]
  const tiers = [...Array(t1).fill(0), ...Array(t2).fill(1)]
  const gap = t1 && t2 ? 5 : 0
  const step = tiers.length > 1 ? Math.min(16, (PIP_SPAN - 15 - gap) / (tiers.length - 1)) : 0
  const g = scene.add.graphics()
  tiers.forEach((p, i) => {
    const x = (i - (tiers.length - 1) / 2) * step + (p ? 1 : -1) * gap / 2
    const d = [{ x, y: -7.5 }, { x: x + 7, y: 0 }, { x, y: 7.5 }, { x: x - 7, y: 0 }]
    g.fillStyle(PATH_PIP[p], 1).fillPoints(d, true)
    g.lineStyle(1.75, INK, 0.95).strokePoints(d, true)
  })
  pips.add(g)
  const gems = (u.relics ?? []).length ? scene.add.graphics() : null
  ;(u.relics ?? []).forEach((id, i) => {
    const x = BAR / 2 + 7 + i * 13
    const gem = [{ x, y: -6 }, { x: x + 5.5, y: -2 }, { x: x + 3.5, y: 5 }, { x: x - 3.5, y: 5 }, { x: x - 5.5, y: -2 }]
    gems.fillStyle(RELIC_TIER[relicDef(id).tier], 1).fillPoints(gem, true)
    gems.lineStyle(1.75, INK, 0.95).strokePoints(gem, true)
  })
  return {
    parts: [pips, gems].filter(Boolean),
    place (x, y) {
      pips.setPosition(x, y + BAR_DROP + 17).setDepth(y + 0.8)
      gems?.setPosition(x, y + BAR_DROP).setDepth(y + 0.8)
    }
  }
}
