// The battle's look, read from the page: the colour tokens, the canvas's print size and the page's two faces.
import { frame } from '../frame.js'

// One colour per system, read from the page's --c-* tokens whenever a scene is made, so the board and the DOM never
// drift apart; these fallbacks are the same values. C holds them as '#rrggbb' for text. Ink and panel are no system's.
export const hex = (c) => parseInt(c.slice(1), 16)
const TOKENS = {
  essence: '#5ef0c0', soul2: '#8ff7d6', foe: '#e0566a', monarch: '#c08a00', plan: '#3697ff', relic: '#ff7f45',
  warn: '#ffdc4a', legendary: '#ab94fc', ossuary: '#b8ae9e', domain: '#84d21a', shadow: '#fb9ad5', path: '#3bd3ea',
  path2: '#b3f3f9', synergy: '#3697ff', common: '#e0c2a8', uncommon: '#ff7f45', rare: '#ffb02e', ink: '#0c0713', panel: '#2d2346'
}
const VAR = { soul2: '--c-essence2', ink: '--ink', panel: '--panel' }
export const C = { ...TOKENS }
// The sides, the Monarch's gold, a domain's green, a shadow's pink, the plan's blue, a kind's tiers, a relic's tier.
export let PARTY, FOE, SOUL, GOLD, CROWN, DOMAIN, RISE, UNDYING, BOON, PLAN, PATH_PIP, RELIC, RELIC_TIER, INK, PANEL
export const NEUTRAL = 0x8a84a8 // the open ground: no system's
export function palette () {
  const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  for (const k in TOKENS) {
    const v = css?.getPropertyValue(VAR[k] ?? `--c-${k}`).trim()
    C[k] = /^#[0-9a-f]{6}$/i.test(v ?? '') ? v : TOKENS[k]
  }
  INK = hex(C.ink)
  PANEL = hex(C.panel)
  PARTY = hex(C.essence)
  FOE = hex(C.foe)
  SOUL = hex(C.soul2)
  GOLD = CROWN = hex(C.monarch)
  DOMAIN = hex(C.domain)
  RISE = hex(C.shadow)
  UNDYING = hex(C.legendary) // a piece rising again (Undying)
  BOON = hex(C.synergy)     // a buff, a cleanse, a rule of yours
  PLAN = hex(C.plan)      // what you set: a move's tiles
  PATH_PIP = [hex(C.path), hex(C.path2)] // a kind's tiers, its first track's and its second's
  RELIC = hex(C.relic)
  RELIC_TIER = { common: hex(C.common), uncommon: hex(C.uncommon), rare: hex(C.rare), legendary: hex(C.legendary) }
}
palette()
// A label on the board stands as large on screen as the page's smallest print at the frame's scale: a number as
// --fs-xs (14 logical px), a word as --fs-sm (16), never under LABEL.floor CSS px. labelPx is in viewport px.
const LABEL = { num: 14, word: 16, floor: 9 }
export const labelPx = (kind = 'word') => Math.max(LABEL.floor, LABEL[kind] * frame.k)
// The scale that brings a label drawn `size` world px tall to labelPx(kind) at the camera's `zoom` (never down);
// labelSize, the world size to draw it at instead (for a label laid out by its size: the battle's HUD).
export const labelScale = (size, zoom, kind = 'word') => (zoom > 0 && size > 0 ? Math.max(1, labelPx(kind) / (size * zoom)) : 1)
export const labelSize = (size, zoom, kind = 'word') => Math.ceil(size * labelScale(size, zoom, kind) * 2) / 2
// A label (a text, or anything with its size given as data 'size': a pill, a flag) kept at labelPx however far
// the camera zooms out; `kind` 'num' or 'word', kept for the next call.
export function legible (t, zoom, kind) {
  if (!t?.active) return t
  kind ??= t.getData('legible') === 'num' ? 'num' : 'word'
  t.setData('legible', kind)
  const size = t.getData('size') ?? parseFloat(t.style?.fontSize)
  if (zoom > 0 && size > 0) t.setScale(labelScale(size, zoom, kind))
  return t
}

// The page's two faces: the system's sans for a sentence, the display face (Fredoka) for every number, name and banner.
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
export const DISPLAY = '"Fredoka", ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
