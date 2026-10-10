// Phaser, used for battles only: the one Phaser Game, the scene that loads the unit and prop pictures and
// makes the FX textures, the battle scene, and the timeline player that turns sim events into tweens and
// FX. It never decides anything: on the old battle it steps a battle that takes no input and plays back what the sim
// emitted; on turns (TUNING.turns) it takes the player's taps as orders (args.order: the run applies each) and plays
// back the events each one made, the foes' turn among them.
import Phaser from './vendor/phaser.js'
import { TUNING } from './tuning.js'
import { UNIT_LIST, unitDef, statusDef, animDef, abilityDef, artUrl, ART_POSES, relicDef, SYNERGIES, FUSIONS } from './content.js'
import { stepBattle, nextCost, rulesOf, escalation } from './sim/battle.js'
import { reach, targetsFrom, preview, legalOrders, canAct, usable, isSkill, hexed, orderable, endable, deadline, nextWave } from './sim/turns.js'
import { foeEssence } from './sim/run.js'
import { tileX, tileY, tileAt, LANES, DEPTH, TILES, ROWS, CAMP_ROWS, distance, rangeOf, footprint, alive, isBlow } from './sim/unit.js'
import { sfx } from './sfx.js'
import { hold, touchy } from './dom.js'
import { frame } from './frame.js'

// ── engine and picture loading ───────────────────────────────────────────────────────────────────

export function createEngine (parent) {
  let ready
  const loaded = new Promise((resolve) => { ready = resolve })
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#08070d',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    callbacks: { preBoot: (g) => g.registry.set('ready', ready) },
    scene: [BootScene, BattleScene]
  })
  return {
    game,
    // Resolves once the pictures are loaded (the prep board, board.js, waits on it too).
    ready: loaded,
    // data: { battle (fresh, from createBattle; on turns the run's own, run.battle), title, stage() (the viewport
    // rect the board fits in), hud (the chrome's words: start, hp, announce), onChange(state), onHover(unit | null,
    // rect, pin), onDone(), essence (what the purse multiplies a slain foe's essence by), seamless (the prep board
    // fades into it: no fade in from black), death() (what felled the Monarch, codex.js deathText, for the end's
    // replay beat, or null), and on turns: turns (true), order(o) (gives an order, returns its events; throws on an
    // illegal one) }. Resolves with the scene once built.
    async battle (data) {
      await loaded
      return new Promise((resolve) => game.scene.start('Battle', { ...data, onReady: resolve }))
    }
  }
}

// The pictures are SVG, rasterised once at RES× their size so they stay sharp when the camera zooms in.
// A unit's are `unit:<art>:alive`, `:attack` and `:dead`; its feet stand at FEET of its height.
const RES = 3
const FEET = 11 / 12
const prop = (name) => new URL(`./assets/props/${name}.svg`, import.meta.url).href
const WALLS = ['wall-0', 'wall-1', 'wall-2']
const WALL_FOOT = 80 / 96 // a wall picture's ground line

// One colour per system (style.css :root, --c-*), read from the page whenever a scene is made (palette), so the
// board and the DOM never drift apart; these fallbacks are the same values. C holds them as '#rrggbb' for text.
// C.soul2 is --c-essence2, essence's pale text tint; synergy is the plan's blue (style.css aliases it).
const hex = (c) => parseInt(c.slice(1), 16)
const TOKENS = {
  essence: '#5ef0c0', soul2: '#8ff7d6', foe: '#e0566a', monarch: '#c08a00', plan: '#3697ff', relic: '#ff7f45',
  warn: '#ffdc4a', legendary: '#ab94fc', ossuary: '#b8ae9e', domain: '#84d21a', shadow: '#fb9ad5', path: '#3bd3ea',
  path2: '#b3f3f9', synergy: '#3697ff', gauge: '#9a95b0'
}
const C = { ...TOKENS }
// The sides and the soulfire (essence, yours), the Monarch's gold (its frame: if its HP runs out, the run ends),
// a domain's green, a shadow's pink (Arise), the rings' and coverage's blue, a kind's tiers.
let PARTY, FOE, SOUL, GOLD, CROWN, DOMAIN, RISE, UNDYING, GAUGE, BOON, PLAN, PATH_PIP
const NEUTRAL = 0x8a84a8 // the open ground between the two daises: no system's
export function palette () {
  const css = typeof document === 'undefined' ? null : getComputedStyle(document.documentElement)
  for (const k in TOKENS) {
    const v = css?.getPropertyValue(k === 'soul2' ? '--c-essence2' : `--c-${k}`).trim()
    C[k] = /^#[0-9a-f]{6}$/i.test(v ?? '') ? v : TOKENS[k]
  }
  PARTY = hex(C.essence)
  FOE = hex(C.foe)
  SOUL = hex(C.soul2)
  GOLD = CROWN = hex(C.monarch)
  DOMAIN = hex(C.domain)
  RISE = hex(C.shadow)
  UNDYING = hex(C.legendary) // a piece rising again (Undying, a Legendary relic)
  GAUGE = hex(C.gauge)
  BOON = hex(C.synergy)     // a buff, a cleanse, a rule of yours: the synergies' (the plan's) blue
  PLAN = hex(C.plan)      // what you set: a ring, coverage
  PATH_PIP = [hex(C.path), hex(C.path2)] // a kind's tiers, its first track's and its second's
}
palette()
// Reduced motion (the page's prefers-reduced-motion, followed as it changes): no camera shake or flash, no
// hit-stop, no breathing or pops, and essence lands at once instead of arcing to the purse.
const motion = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)')
let calm = !!motion?.matches
motion?.addEventListener?.('change', (e) => { calm = e.matches })
export const reducedMotion = () => calm
// The canvas's print follows the page's: a label on the board stands at least as large on screen as the page's
// smallest print at the frame's scale (frame.js), a number (a level, ×0.7, a count, a hit) as --fs-xs (14
// logical px) and a word as --fs-sm (16), and never under LABEL.floor CSS px however small the frame. So at
// 1440×900 (k 1.25) a word stands 20 px tall, on a phone in landscape (k ≈ 0.55) 9. In viewport px.
const LABEL = { num: 14, word: 16, floor: 9 }
const labelPx = (kind = 'word') => Math.max(LABEL.floor, LABEL[kind] * frame.k)
// The scale that brings a label drawn `size` world px tall to labelPx(kind) at the camera's `zoom` (never down);
// labelSize, the world size to draw it at instead (for a label laid out by its size: the battle's HUD).
const labelScale = (size, zoom, kind = 'word') => (zoom > 0 && size > 0 ? Math.max(1, labelPx(kind) / (size * zoom)) : 1)
const labelSize = (size, zoom, kind = 'word') => Math.ceil(size * labelScale(size, zoom, kind) * 2) / 2
// Under SERIF_MIN CSS px the serif's thin strokes break up ("THF MONARCH"): a label that would stand smaller is
// set in the sans. faceFor: the face for a label drawn `size` world px tall, kept legible, at `zoom`.
const SERIF_MIN = 14
const faceFor = (size, zoom, kind = 'word') => (size * labelScale(size, zoom, kind) * (zoom || 1) >= SERIF_MIN ? SERIF : FONT)
// A label (a text, or anything with its size given as data 'size': a pill, a flag) kept at labelPx however far
// the camera zooms out; `kind` 'num' or 'word', kept for the next call (the board rescales these as its
// camera zooms: board.js fit; the battle's are in `small`: BattleScene.fit).
export function legible (t, zoom, kind) {
  if (!t?.active) return t
  kind ??= t.getData('legible') === 'num' ? 'num' : 'word'
  t.setData('legible', kind)
  const size = t.getData('size') ?? parseFloat(t.style?.fontSize)
  if (zoom > 0 && size > 0) t.setScale(labelScale(size, zoom, kind))
  return t
}
const TITHE = '#ff6a8a'  // the HP Blood Tithe takes from the Monarch
const SHADE_ALPHA = 0.8 // a shadow is see-through
const HEX = 0x9b5cff     // Hexed: the violet pall over the hexed (wear)
const FLOAT_ROWS = 4    // popups over one unit stack this many rows high at once (see floating)
// ms a popup holds its row (by then it has drifted most of a row up, and faded): one that comes sooner takes
// a row above it, or waits for one. Long enough to cover the beat between an event (a rule's name) and the
// numbers its action's impact shows a few hundred ms later.
const FLOAT_HOLD = 520
// A status's name rises in a column of its own beside the unit (floating, `side`), never over the numbers.
const SIDE_ROW = 13
const HIT_WASH = 0x8c8c8c // a blow's flash: screened over the struck, about half way to white (flash)
const ROT = 0xd88ab8   // the Sovereign's Grave Tide: the glow its shadows rise in, on the foes' side
const ORDINAL = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH']

class BootScene extends Phaser.Scene {
  constructor () { super('Boot') }

  preload () {
    for (const u of UNIT_LIST) {
      for (const pose of ART_POSES) this.load.svg(`unit:${u.art}:${pose}`, artUrl(u.id, pose), { scale: RES })
    }
    for (const w of WALLS) this.load.svg(w, prop(w), { scale: RES })
    this.load.svg('floor', prop('floor'), { scale: 2 })
    this.load.on('loaderror', (file) => console.error('failed to load', file.key, file.src))
  }

  create () {
    makeTextures(this)
    this.registry.get('ready')?.()
  }
}

// Soft FX textures drawn once on canvases: a radial glow, a small spark, and the vignette over the floor.
function makeTextures (scene) {
  const canvas = (key, w, hgt, draw) => {
    if (scene.textures.exists(key)) return
    const t = scene.textures.createCanvas(key, w, hgt)
    draw(t.getContext(), w, hgt)
    t.refresh()
    t.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
  const radial = (ctx, w, stops) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    for (const [at, c] of stops) g.addColorStop(at, c)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  }
  canvas('glow', 64, 64, (ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]))
  canvas('spark', 16, 16, (ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]))
  // A crescent for blade swings: the gap between two offset circles, brightest at its belly.
  canvas('slash', 128, 128, (ctx, w) => {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.75, 'rgba(255,255,255,.9)')
    g.addColorStop(1, 'rgba(255,255,255,1)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2); ctx.fill()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath(); ctx.arc(w / 2 - w * 0.1, w / 2, w * 0.44, 0, Math.PI * 2); ctx.fill()
  })
  canvas('vignette', 512, 512, (ctx, w) => radial(ctx, w, [[0, 'rgba(6,5,10,0)'], [0.55, 'rgba(6,5,10,.25)'], [1, 'rgba(6,5,10,.96)']]))
}

// A shadow's pictures, `shade:<art>:<pose>`: the unit's own, drained of colour and washed a cold grave-green
// (made from the rasterised SVG on first use; the alpha is kept, and the sprite is drawn see-through too).
// A shadow on their side (raised by the Sovereign's Grave Tide, or one of yours risen against you by their
// Legion) is `shadefoe:`, washed a bruised rose instead.
const SHADE_WASH = {
  shade: (l) => [0.5 * l + 10, 0.92 * l + 34, 0.7 * l + 24],
  shadefoe: (l) => [0.9 * l + 34, 0.5 * l + 12, 0.78 * l + 36]
}
function shadeTextures (scene, art, skin = 'shade') {
  for (const pose of ART_POSES) {
    const key = `${skin}:${art}:${pose}`
    if (scene.textures.exists(key)) continue
    const src = scene.textures.get(`unit:${art}:${pose}`).getSourceImage()
    const t = scene.textures.createCanvas(key, src.width, src.height)
    const ctx = t.getContext()
    ctx.drawImage(src, 0, 0)
    const img = ctx.getImageData(0, 0, src.width, src.height)
    const px = img.data
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = SHADE_WASH[skin](0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2])
      px[i] = Math.min(255, r)
      px[i + 1] = Math.min(255, g)
      px[i + 2] = Math.min(255, b)
    }
    ctx.putImageData(img, 0, 0)
    t.refresh()
    t.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
}

// ── a soul's marks, shared with the prep board (board.js) ─────────────────────────────────────────

// The domain's caption, "ARISE · 5" (Arise's reach, in tiles: the player's word for it is the relic's), a legend on
// a dark plate, standing just outside the box (placeOutside), over the units: never inside it, where the marks of
// whoever stands in its edge row are.
export function domainLabel (scene, r) {
  return scene.add.text(0, 0, `ARISE · ${r}`,
    { fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: C.domain, backgroundColor: '#07060bd9', padding: { x: 5, y: 2 } })
    .setResolution(3).setOrigin(0, 0)
}

// The area two world rects ({ l, r, t, b }) share.
export const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))

// Puts `t` (a top-left origin label, already scaled) just outside one corner of `box`: above or below its edge,
// at its left or right end, whichever covers least of `blocked` (world rects: the units' bodies and marks; `w`,
// a rect's weight: print counts more than a body), keeping inside `limit` (the board's box) where it can.
// → its rect.
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

// A soul's growth, the same on the prep board and in battle so the picture carries over: a diamond a tier under
// its bars, --c-path its kind's first track and --c-path2 its second. → { parts, place(x, y) }, placed every frame
// from the feet.
export function growthMarks (scene, u) {
  // A diamond a tier, centred under the bars: the first track's, then a gap, then the second's. Kept inside the
  // unit's lane (PIP_SPAN wide): many tiers stand closer, overlapping like a chain.
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
    g.lineStyle(1.75, 0x07060b, 0.95).strokePoints(d, true)
  })
  pips.add(g)
  return {
    parts: [pips],
    place (x, y) { pips.setPosition(x, y + BAR_DROP + 17).setDepth(y + 0.8) }
  }
}

// ── the board on screen ──────────────────────────────────────────────────────────────────────────

// The board lies on its side (DESIGN §4), the Bloons TD way, so it can take the screen's width: its long axis, the
// DEPTH rows from your camp's rear to their back row, runs across, your camp on the right beside the panel (a soul
// dragged from the ossuary has the shortest way to go) and theirs on the left, where the foes come in; its LANES
// lanes run down it, lane 1 at the bottom (the board turned a quarter, never mirrored). A tile is TILE_W wide and
// TILE_H tall, a unit's feet FOOT below its centre (it stands in its cell, its head only a little over the one
// above). The sim's tiles are untouched: here, and only here, a tile becomes a point (posOf: where a unit's feet
// stand) and a point a tile (tileUnder); the prep board (board.js) uses the same.
const TILE_W = 76
const TILE_H = 68
const FOOT = 12
const HALF_W = DEPTH * TILE_W / 2
const HALF_H = LANES * TILE_H / 2
const posOf = (tile) => ({ x: ((DEPTH - 1) / 2 - tileY(tile)) * TILE_W, y: ((LANES - 1) / 2 - tileX(tile)) * TILE_H + FOOT })
// Where a piece of `size` anchored at `tile` stands: a 2×2's feet at the middle of its four tiles (its footprint runs
// a lane up the screen and a row toward the foes, left: unit.js footprint).
const posAt = (tile, size = 1) => {
  const p = posOf(tile)
  return size > 1 ? { x: p.x - (size - 1) * TILE_W / 2, y: p.y - (size - 1) * TILE_H / 2 } : p
}
// A 2×2 piece is drawn this much larger than a one-tile one (DESIGN §4: large over its four tiles); a flyer hovers HOVER
// world px over its shadow, bobbing BOB px.
const BIG = 1.75
const HOVER = 26
const BOB = 3
// A flyer and a unit on the ground on one tile (the sim's air, battle.sky, over its ground, battle.at): each eases
// SHARE.x world px aside, the flyer right and SHARE.up higher, and their bars narrow to SHARE.bar of their width, so
// the two read apart. A 2×2 on the ground stands still; the flyer moves for both.
const SHARE = { x: 20, up: 6, bar: 0.6, ms: 140 }
// The tile whose cell holds world point (x, y), or off the board the nearest.
function tileUnder (x, y) {
  const clamp = (v, n) => Math.max(0, Math.min(n - 1, v))
  return tileAt(clamp(Math.round((LANES - 1) / 2 - y / TILE_H), LANES), clamp(Math.round((DEPTH - 1) / 2 - x / TILE_W), DEPTH))
}
// The world box of the cells of lanes x0 to x1 and rows y0 to y1 (inclusive, either order), inset by `pad`.
function cellsBox (x0, x1, y0, y1, pad = 0) {
  return {
    l: ((DEPTH - 1) / 2 - Math.max(y0, y1)) * TILE_W - TILE_W / 2 + pad,
    r: ((DEPTH - 1) / 2 - Math.min(y0, y1)) * TILE_W + TILE_W / 2 - pad,
    t: ((LANES - 1) / 2 - Math.max(x0, x1)) * TILE_H - TILE_H / 2 + pad,
    b: ((LANES - 1) / 2 - Math.min(x0, x1)) * TILE_H + TILE_H / 2 - pad
  }
}
// The world box the camera keeps in view: the board, with room over its top lane for the heads of who stands
// there, and a little under its bottom lane.
const BOX = { l: -HALF_W - 8, r: HALF_W + 8, t: -HALF_H - 38, b: HALF_H + 6 }
// Your side faces left, across the board at theirs; theirs faces right (the pictures face right).
const facesLeft = (side) => side === 'party'

// The camera onto `box` (world) inside `rect` (viewport), as large as it fits, at most `max`: its zoom, and a
// world point with the viewport point it shows at. → { z, wx, wy, sx, sy }
export function fitBox (rect, box, max = 1.35) {
  const z = Math.max(0.25, Math.min(max, (rect.width - 8) / (box.r - box.l), (rect.height - 6) / (box.b - box.t)))
  return { z, wx: (box.l + box.r) / 2, wy: (box.t + box.b) / 2, sx: rect.left + rect.width / 2, sy: rect.top + rect.height / 2 }
}

// The square a ring or a domain covers round a footprint of `size` anchored at `tile` (`r` tiles every way from it,
// clipped to the board), as a world box.
export function ringBox (tile, r, pad = 0, size = 1) {
  const [x, y] = [tileX(tile), tileY(tile)]
  return cellsBox(Math.max(0, x - r), Math.min(LANES - 1, x + size - 1 + r), Math.max(0, y - r), Math.min(DEPTH - 1, y + size - 1 + r), pad)
}

// The ground both boards stand on (the prep board's and the battle's, so one fades into the other): the crypt
// floor, a vignette and the dark past it, a dais under your camp and one under their formation, a seam of
// soulfire down the open ground between, and drifting motes.
export function drawGround (scene) {
  scene.add.tileSprite(0, 0, 4200, 3200, 'floor').setTileScale(0.6).setAlpha(0.62).setDepth(-1000)
  const [vw, vh] = [2 * HALF_W + 1100, 2 * HALF_H + 1000]
  scene.add.image(0, 0, 'vignette').setDisplaySize(vw, vh).setDepth(-999)
  for (const [x, y, w, h] of [[0, -vh / 2 - 1500, 9000, 3000], [0, vh / 2 + 1500, 9000, 3000], [-vw / 2 - 2000, 0, 4000, vh], [vw / 2 + 2000, 0, 4000, vh]]) {
    scene.add.rectangle(x, y, w + 2, h + 2, 0x06050a, 0.96).setDepth(-999)
  }
  const g = scene.add.graphics().setDepth(-401)
  for (const [y0, y1, colour] of [[0, CAMP_ROWS - 1, PARTY], [DEPTH - ROWS, DEPTH - 1, FOE]]) {
    const b = cellsBox(0, LANES - 1, y0, y1, -10)
    g.fillStyle(colour, 0.045).fillRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 18)
    g.lineStyle(1, colour, 0.22).strokeRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 18)
  }
  const seam = ((DEPTH - 1) / 2 - (CAMP_ROWS + DEPTH - ROWS - 1) / 2) * TILE_W
  scene.add.image(seam, 0, 'glow').setDisplaySize(26, 2 * HALF_H + 200).setTint(NEUTRAL).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(-390)
  scene.add.particles(0, 0, 'glow', {
    x: { min: -HALF_W - 60, max: HALF_W + 60 }, y: { min: -HALF_H - 40, max: HALF_H + 40 }, lifespan: 7000,
    speedY: { min: -14, max: -4 }, speedX: { min: -6, max: 6 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.45, end: 0 },
    tint: [SOUL, NEUTRAL], frequency: 160, blendMode: 'ADD'
  }).setDepth(-300)
}

// ── battle scene ─────────────────────────────────────────────────────────────────────────────────

// The battle screen: the shared board, your walled camp on the right and the foes on the left. It steps the
// battle on the same clock that plays the events back. Pause, speed and skip change only the playback; the
// outcome was fixed when it began.

const WALK_MS = 300
const STEP_MS = 190     // on turns, a tile of a move's path
// On turns, a skill's cooldown pip under a piece's bars: lit (the Monarch's gold) once ready, `rest` while it rests.
const PIP = { w: 7, h: 4, step: 9, rest: 0x3a3258 }
// On turns: a tap moves no more than this (CSS px) between press and release, and the ground's marks (plan).
const TAP_SLOP = 10
const SCALE = 0.95      // world px per unit of a picture's viewBox
const WALL_SCALE = 1
const BREATH = 0.014    // idle breathing: the share of its height a unit swells by
const REST = { lean: 0, sx: 0, sy: 0, dx: 0, dy: 0 } // a unit's pose at rest: see animate
const BAR = 46
const BAR_DROP = 14     // from the feet down to the HP bar, clear of the pictures' ground details
const PIP_SPAN = 78     // a soul's tiers stand within this width under its bars, inside its lane
const ECHO_MS = 260     // Echo (Channeler 8): its second pass lands this long after the first
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'

// The rules, the 8 steps of the synergies (content.js): by rule, its step ("Undead 8") and its name ("The
// Legion", the head of its desc), and on whom its name rises when it strikes: the unit it acts through.
const RULES = Object.fromEntries(SYNERGIES.filter((syn) => syn.rule).map((syn) => [syn.rule, { step: syn.name, name: syn.desc.split(': ')[0] }]))
const RULE_ON = { frenzy: 'actor', echo: 'actor', bodyguard: 'actor', sanctuary: 'actor', dragonfire: 'actor', deadeye: 'actor' }
// Rules that strike on almost every cast: their name rises at most once a NOISY_MS per side.
const NOISY = new Set(['sanctuary', 'echo', 'dragonfire', 'deadeye'])
const NOISY_MS = 1000

// A side's synergies for its label, short: of each kin's or role's steps only the top one reached, an 8 by
// its rule ("★ Undead 8: The Legion"); the pacts as they are.
const stepOf = (syn) => {
  const needs = ['kin', 'role'].flatMap((axis) => Object.entries(syn.needs[axis] ?? {}).map(([id, n]) => ({ key: `${axis}:${id}`, n })))
  return needs.length === 1 ? needs[0] : null
}
function topSteps (ids) {
  const syns = ids.map((id) => SYNERGIES.find((syn) => syn.id === id)).filter(Boolean)
  return syns.filter((syn) => !stepOf(syn) || !syns.some((o) => stepOf(o)?.key === stepOf(syn).key && stepOf(o).n > stepOf(syn).n))
    .map((syn) => (syn.rule ? `★ ${syn.name}: ${RULES[syn.rule].name}` : syn.name))
}

class BattleScene extends Phaser.Scene {
  constructor () { super('Battle') }

  init (data) {
    this.args = data
    this.battle = data.battle
    // On turns: no clock to step; the playback runs on its own time (TimelinePlayer, by beat), and between orders
    // the board waits for the player. `sel`: the piece selected ({ uid, ability: the act armed, aim: the target
    // previewed, reach: its Move range, targets }); `waiting`: an order's events still playing (input locked);
    // `clock`: the turn, the last turn before the cap and the next wave, as the playback last announced them.
    this.turns = !!data.turns
    this.speed = 1
    this.paused = false
    this.playMs = this.turns ? 0 : this.battle.t * TUNING.tick.ms
    this.sel = null
    this.waiting = false
    this.clock = this.turns ? { turn: this.battle.turn, cap: deadline(this.battle), next: nextWave(this.battle) } : null
    this.ending = false
    this.hover = null
    // The end's replay beat (finish), drawn each frame once the battle is lost (drawEnd).
    this.endBeat = null
    this.endG = null
    this.small = [] // labels kept legible as the camera zooms (fit)
    this.announced = new Set() // `side|rule`: the rules already named this battle
    this.noisy = new Map() // `side|rule` → playMs its name last rose, for the NOISY rules
    // On this battle's clock (playMs), so none carries over from the last battle the scene played: the Monarch's
    // last shake when struck, and the last wave-paid popup with how many stack under it (wavePaid).
    this.monarchShook = -Infinity
    this.payAt = -1e9
    this.payStack = 0
  }

  create () {
    palette()
    this.actors = new Map()
    this.units = new Map(this.battle.units.map((u) => [u.uid, u]))
    this.emitters = new Map()
    const start = this.battle.events.find((e) => e.type === 'battle:start')
    // The Monarch's uid (null in a battle without one) and Arise's reach about it (the domain).
    this.monarch = start.monarch
    this.domain = start.domain
    // The foes by wave (0: the formation on the board), for the banner as each arrives (how many foes, `size`) and
    // the essence each pays as its foes are slain (`left`: its foes still standing).
    const foes = [...start.units.filter((u) => u.side === 'foe'), ...(start.reserve ?? []).filter((r) => r.side === 'foe')]
    this.waves = []
    for (const f of foes) {
      const w = (this.waves[f.wave ?? 0] ??= { size: 0, left: 0, paid: 0, shown: false, when: f.when ?? null, boss: false })
      w.size++
      w.left++
      w.boss ||= !!unitDef(f.id).boss
    }
    this.essence = this.args.essence ?? 1
    // Essence carried so far, counted as each slain foe's orb reaches the bar (see pay); the hit-stop holding
    // the playback (see hitStop); whether the opening sound has played.
    this.purse = 0
    this.owed = 0
    this.stopUntil = 0
    this.begun = false
    this.crumbling = false
    this.holdUntil = 0
    this.decorate(start)
    for (const u of start.units) this.addActor(u)
    // Burning: flames licking up the picture of whoever burns (wear), over the units.
    this.flames = this.add.particles(0, 0, 'spark', {
      emitting: false, lifespan: 460, speedY: { min: -85, max: -35 }, speedX: { min: -12, max: 12 },
      scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.95, end: 0 }, tint: [0xffe08a, 0xffa040, 0xff5a1e], blendMode: 'ADD'
    }).setDepth(9150)
    // Kicked up where the dead hit the ground: low, sideways, settling.
    this.dust = this.add.particles(0, 0, 'glow', {
      emitting: false, lifespan: 650, speedX: { min: -120, max: 120 }, speedY: { min: -40, max: -5 }, gravityY: 70,
      scale: { start: 0.32, end: 0.08 }, alpha: { start: 0.45, end: 0 }, tint: [0x6e6680, 0x8a8094, 0x544c64]
    }).setDepth(9100)

    this.player = new TimelinePlayer(this, {
      template: (id) => animDef(id),
      actorOf: (uid) => this.actors.get(uid),
      tickMs: TUNING.tick.ms,
      beats: this.turns,
      onEvent: (ev, inAction, seq) => this.applyEvent(ev, inAction, seq)
    })
    // On turns: what the selection lights (plan), under the units, and the preview's numbers over them.
    this.planG = this.add.graphics().setDepth(-390)
    this.aimMarks = []
    // battle:start is already in battle.events; anything after it has not been played.
    this.player.enqueue(this.battle.events.slice(this.battle.events.indexOf(start) + 1))
    this.player.setSpeed(this.speed)

    this.fit()
    this.scale.on('resize', this.fit, this)
    // By touch a unit's card comes by a long press on it, pinned (dom.js hold), never by a finger passing over; a
    // mouse's click pins it too, so its details open by More ▾ and never need Shift.
    // On turns a tap (a click, or a finger lifted where it went down) gives orders (tap); a long press still pins the
    // card, and a mouse reads it on the hover.
    const canvas = this.game.canvas
    const press = (e) => {
      if (this.turns) return this.down(e)
      if (e.pointerType !== 'touch') { if (e.button === 0) this.pressAt(e.clientX, e.clientY, this.hover) } else if (e.isPrimary) hold(e, () => this.pressAt(e.clientX, e.clientY))
    }
    canvas.addEventListener('pointerdown', press)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.fit, this)
      canvas.removeEventListener('pointerdown', press)
      this.tweens.timeScale = 1
      this.args.onHover?.(null)
    })
    // From prep the board fades into it instead (board.js): the units already stand where they will start.
    if (!this.args.seamless) this.cameras.main.fadeIn(260, 6, 5, 10)
    this.lastSecond = -1
    // On turns the opening (the first turn's announcement) plays before the board takes orders.
    this.waiting = this.turns
    this.changed()
    this.args.onReady?.(this)
  }

  // The camera onto the board inside the page's stage for it (args.stage(): a viewport rect, the room the
  // battle's chrome leaves; the whole canvas without one), as large as it fits: the prep board's own view.
  fit () {
    const cam = this.cameras.main
    const c = this.game.canvas.getBoundingClientRect()
    const r = this.args.stage?.() ?? c
    if (!r.width || !r.height) return
    const v = fitBox(r, BOX)
    cam.setViewport(0, 0, Math.round(c.width), Math.round(c.height))
    cam.setZoom(v.z)
    cam.centerOn(v.wx - (v.sx - c.left - cam.width / 2) / v.z, v.wy - (v.sy - c.top - cam.height / 2) / v.z)
    for (const t of this.small ?? []) legible(t, v.z)
    this.placeDomain()
  }

  update (time, delta) {
    const b = this.battle
    // A hit-stop holds the clock (see hitStop); once it is over the tweens run at the speed again.
    const held = this.stopUntil > time
    if (this.stopUntil && !held) { this.stopUntil = 0; this.tweens.timeScale = this.speed }
    if (!this.paused && !held) {
      if (!this.begun) { this.begun = true; sfx.play('begin') }
      this.playMs += Math.min(delta, 250) * this.speed
      if (!this.turns) {
        const want = Math.floor(this.playMs / TUNING.tick.ms)
        const events = []
        while (!b.over && b.t < want) events.push(...stepBattle(b))
        if (events.length) this.player.enqueue(events)
      }
    }
    this.player.update(this.playMs)
    // An order's events played out: the board takes orders again.
    if (this.waiting && this.player.finished && !b.over) {
      this.waiting = false
      this.settle()
    }
    // The end waits for the crumble (see crumble) to play out.
    if (b.over && this.player.finished && !this.ending && this.playMs >= this.holdUntil) this.finish()

    // The tiles the living hold in the air and on the ground (a 2×2 all four), for who shares one (SHARE).
    const air = new Set()
    const ground = new Set()
    for (const a of this.actors.values()) if (!a.gone) for (const t of footprint(a.tile, a.fp) ?? [a.tile]) (a.fly ? air : ground).add(t)
    for (const a of this.actors.values()) {
      const mate = !a.gone && (a.fly ? ground.has(a.tile) : a.fp === 1 && air.has(a.tile))
      a.share += ((mate ? 1 : 0) - a.share) * (calm ? 1 : Math.min(1, delta / SHARE.ms))
      const sx = (a.fly ? 1 : -1) * SHARE.x * a.share
      a.up = a.fly ? SHARE.up * a.share : 0
      const k = 1 - (1 - SHARE.bar) * a.share
      const x = a.vx = a.sprite.x + sx
      const y = a.sprite.y + BAR_DROP
      // The pose (see animate) and breathing, which keeps the playback clock so pause holds it. The pose's
      // dx, dy move the picture off its feet through the origin, leaving x, y to the steps.
      const p = a.pose
      const breath = a.gone || calm ? 0 : BREATH * Math.sin(this.playMs / 640 + a.uid)
      a.sprite.setScale(a.scale * (1 + p.sx), a.scale * (1 + p.sy + breath))
      a.sprite.angle = p.lean
      // A flyer floats a.hover over its shadow, bobbing (DESIGN §4); its bars and shadow stay on the ground.
      const bob = a.hover && !calm ? BOB * Math.sin(this.playMs / 420 + a.uid) * a.hover / HOVER : 0
      a.sprite.setOrigin(0.5 - (p.dx + sx) / a.sprite.displayWidth, FEET - (p.dy - a.hover - a.up - bob) / a.sprite.displayHeight)
      // The dead lie under the living who step over them; a flyer over whoever shares its row.
      a.sprite.setDepth(a.gone ? a.sprite.y - TILE_H / 2 : a.sprite.y + (a.hover ? 1 : 0))
      a.shadow.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 2)
      a.ring.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 1)
      // The bars lie on the ground under the feet, sorted with the units: whoever stands in front draws
      // over them, so they never cover a picture.
      const foot = a.sprite.y + 0.5
      a.barBg.setPosition(x, y + 2).setScale(k, 1).setDepth(foot)
      a.trail.setPosition(x - BAR * k / 2, y).setScale(k, 1).setDepth(foot + 0.1)
      a.bar.setPosition(x - BAR * k / 2, y).setScale(k, 1).setDepth(foot + 0.2)
      a.gaugeBar.setPosition(x - BAR * k / 2, y + 5).setScale(k, 1).setDepth(foot + 0.2)
      a.pips?.forEach((p, i) => p.setPosition(x - BAR * k / 2 + i * PIP.step * k, y + 7).setScale(k, 1).setDepth(foot + 0.2))
      a.growth?.place(x, a.sprite.y)
      a.sprite.setAlpha(a.fade * a.rise.v * (a.shade ? SHADE_ALPHA : 1))
      const u = this.units.get(a.uid)
      this.wear(a, u)
      // On turns a skill's cooldown pip: lit once it may be used again (sim, u.cooldowns), dark while it rests.
      if (a.pips && !a.gone) a.skills.forEach((id, i) => a.pips[i].setFillStyle(u.cooldowns?.[id] > 0 ? PIP.rest : GOLD, u.cooldowns?.[id] > 0 ? 0.9 : 1))
      if (!this.turns && !a.gone && u.hp > 0) {
        const cost = nextCost(b, u)
        const fill = Math.min(1, u.gauge / cost)
        a.gaugeBar.width = BAR * fill
        a.gaugeBar.setFillStyle(fill >= 1 ? 0xffffff : GAUGE, fill >= 1 ? 1 : 0.85)
      }
    }

    this.drawEnd(time)

    const second = this.turns ? this.lastSecond : Math.floor(b.t * TUNING.tick.ms / 1000)
    if (second !== this.lastSecond) {
      this.lastSecond = second
      this.changed()
    }
  }

  // ── controls (called by the DOM playback bar) ────────────────────────────────────────────────

  setSpeed (n) {
    this.speed = n
    this.player.setSpeed(n)
    this.changed()
  }

  setPaused (on) {
    if (this.ending) return
    this.paused = on
    if (on) this.tweens.pauseAll()
    else this.tweens.resumeAll()
    this.changed()
  }

  togglePause () {
    this.setPaused(!this.paused)
  }

  // Leave now; the run already knows how the battle ended. On turns the battle is the player's to play, so Skip only
  // hurries the playback (flush) until the battle is over and its banner up.
  skip () {
    if (this.turns && !this.ending) return this.flush()
    const done = this.args.onDone
    if (!done) return
    this.args.onDone = null
    this.scene.stop()
    done()
  }

  // What the playback bar shows: the clock, the purse, the wave under way of how many (`wave` of `waves`), and
  // the escalation bar: `left`, the share of the window before the ceiling still to run (it counts from the
  // last foe to enter, so a wave fills it again), `ramp`, the share at which every blow starts to climb, and
  // `esc`, the multiplier now.
  // On turns instead: the turn as the playback has reached it, the last turn before the cap, the next wave (turn
  // events), the wave under way, whether input waits (busy), and the selected piece's panel (panel).
  changed () {
    const b = this.battle
    if (this.turns) {
      const c = this.clock
      return this.args.onChange?.({
        turns: true, paused: this.paused, speed: this.speed, over: this.ending, essence: this.purse,
        turn: c.turn, last: c.cap, cap: b.cap, next: c.next, wave: Math.max(1, b.waveAt.length), waves: Math.max(b.waveAt.length, this.waves.length),
        busy: this.locked(), panel: this.panel()
      })
    }
    const E = TUNING.escalation
    const ceiling = b.ceiling ?? TUNING.tick.ceiling
    this.args.onChange?.({
      paused: this.paused,
      speed: this.speed,
      seconds: b.t * TUNING.tick.ms / 1000,
      over: this.ending,
      essence: this.purse,
      wave: b.waveAt.length,
      waves: Math.max(b.waveAt.length, this.waves.length),
      left: Math.max(0, Math.min(1, 1 - (b.t - b.foeIn) / ceiling)),
      ramp: E.startTick * (b.boss ? E.bossMult : 1) / ceiling,
      esc: escalation(b)
    })
  }

  // The camera's shudder and flash, kept for what matters (a crit, a heavy fall, the Monarch struck, a
  // boss's turn): routine blows and falls never shake. None at all under reduced motion.
  shake (ms, mag) {
    if (!calm) this.cameras.main.shake(ms, mag)
  }

  // A piece of yours, a boss or the Monarch: its fall shakes and holds.
  heavy (uid) {
    const u = this.units.get(uid)
    return !!u && !u.shadow && (!!unitDef(u.id).boss || u.uid === this.monarch || u.side === 'party')
  }

  flashScreen (ms, r, g, b) {
    if (!calm) this.cameras.main.flash(ms, r, g, b)
  }

  // A beat of stillness on a heavy blow (a crit, a heavy fall): the clock stops and the tweens
  // all but freeze for `ms`, shorter at 2×, none at 4×; at most one every 300 ms, so a melee never stutters.
  // None under reduced motion.
  hitStop (ms) {
    if (calm || this.speed >= 4 || this.paused || this.ending) return
    const now = this.game.loop.time
    if (now - (this.lastStop ?? -1e9) < 300) return
    this.lastStop = now
    this.stopUntil = now + ms / this.speed
    this.tweens.timeScale = 0.04 * this.speed
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  // A shadow (u.shadow, raised by Arise, summoned by a kind's tier, or on the foes' side by Grave Tide) wears the
  // shade pictures; the Monarch's HP bar is thicker, in a gold frame. One unit, one figure.
  // A 2×2 piece is drawn BIG× over the middle of its four tiles; a flyer (its kind's `flies`, a shadow of one too)
  // hovers HOVER over its shadow, which is fainter.
  addActor (u) {
    const fp = u.size ?? 1
    const big = fp > 1 ? BIG : 1
    const fly = unitDef(u.id).flies ? HOVER : 0
    const home = posAt(u.tile, fp)
    const art = unitDef(u.id).art
    const theirs = u.side === 'foe'
    const skin = !u.shadow ? 'unit' : theirs ? 'shadefoe' : 'shade'
    if (u.shadow) shadeTextures(this, art, skin)
    const crowned = u.uid === this.monarch
    const side = u.shadow ? (theirs ? 0xe0a0bc : RISE) : u.side === 'party' ? PARTY : FOE
    const sprite = this.add.image(home.x, home.y, `${skin}:${art}:alive`).setOrigin(0.5, FEET).setDepth(home.y)
      .setFlipX(facesLeft(u.side))
    const whole = this.units.get(u.uid) ?? u
    const scale = SCALE / RES * big
    // Pictures are drawn on a 96 box, the boss on a bigger one; the shadow and FX heights follow.
    const size = sprite.width / RES / 96 * big
    // A shadow stands in a pale-green glow of its own instead of a dark pool.
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size * (fly ? 0.8 : 1), 13 * size * (fly ? 0.8 : 1), u.shadow ? (theirs ? ROT : RISE) : 0x000000,
      (u.shadow ? 0.4 : 0.5) * (fly ? 0.65 : 1)).setDepth(home.y - 2)
    if (u.shadow) shadow.setBlendMode(Phaser.BlendModes.ADD)
    const ring = this.add.ellipse(home.x, home.y + 4, 56 * size, 17 * size).setStrokeStyle(1.5, 0xffffff, 0.8).setDepth(home.y - 1).setVisible(false)
    const barBg = this.add.rectangle(home.x, home.y + 14, BAR + 2, crowned ? 12 : 10, 0x07060b, 0.92).setStrokeStyle(1, crowned ? CROWN : 0x2c2740)
    const width = BAR * u.hp / u.maxHp
    const trail = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, 0xfff1d0, 0.85).setOrigin(0, 0.5)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, side).setOrigin(0, 0.5)
    const gaugeBar = this.add.rectangle(home.x - BAR / 2, home.y + 17, 0, 2, GOLD).setOrigin(0, 0.5)
    // On turns a piece of yours carries a pip a skill under its bars (its cooldown: update); the Monarch, the shadows
    // and the foes none (a foe's readiness would tell its coming turn).
    const skills = this.turns && u.side === 'party' && !u.shadow && !crowned ? (whole.kit ?? []).filter((a) => isSkill(whole, a)).map((a) => a.id) : []
    const actor = {
      uid: u.uid, id: u.id, side: u.side, tile: u.tile, art, skin, shade: !!u.shadow, sprite, scale, home, shadow, ring, bar, trail, barBg, gaugeBar,
      // fp: its footprint's side, big: its picture's scale for it; hover: how high it floats now (fly: when standing).
      fp, big, fly, hover: fly,
      // chest: how far above the feet blows land and bolts fly from. fade: 0 once a corpse has risen
      // as a shadow; rise.v: a shadow coming up out of the ground (apart from `fade`, so a walk that kills
      // the actor's tweens never leaves it invisible).
      chest: 30 * size + fly, pose: { ...REST }, hp: u.hp, maxHp: u.maxHp, gone: false, fade: 1, rise: { v: 1 },
      // share: how far it has eased aside for another on its tile (SHARE, 0 to 1); vx, up: where that puts it.
      share: 0, vx: home.x, up: 0,
      skills, pips: skills.length ? skills.map(() => this.add.rectangle(home.x, home.y + 19, PIP.w, PIP.h, GOLD).setOrigin(0, 0.5)) : null
    }
    // A soul's growth, worn as the prep board showed it (growthMarks): its tiers.
    if (u.side === 'party' && !u.shadow && !crowned) actor.growth = growthMarks(this, whole)
    sprite.setInteractive(this.input.makePixelPerfect())
    sprite.on('pointerover', (p) => {
      if (p.wasTouch || touchy()) return
      this.hover = u.uid
      ring.setVisible(!actor.gone)
      this.args.onHover?.(this.units.get(u.uid), { left: p.x + 14, right: p.x + 14, top: p.y - 10, bottom: p.y + 10 })
    })
    sprite.on('pointerout', () => {
      ring.setVisible(false)
      if (this.hover === u.uid) { this.hover = null; this.args.onHover?.(null) }
    })
    this.actors.set(u.uid, actor)
  }

  // A long press or a click at viewport point (x, y): the card of the unit there, the front-most where two overlap
  // (the one lower on the board, drawn over), pinned beside the pointer; `uid`, the unit the mouse is over, first.
  pressAt (x, y, uid = null) {
    if (!this.sys.isActive()) return
    const r = this.game.canvas.getBoundingClientRect()
    const w = this.cameras.main.getWorldPoint((x - r.left) * this.scale.width / r.width, (y - r.top) * this.scale.height / r.height)
    let best = uid != null ? this.actors.get(uid) ?? null : null
    // Two on one tile (SHARE): the one whose picture's middle is nearer.
    const off = (a) => { const b = a.sprite.getBounds(); return Math.hypot(b.centerX - w.x, b.centerY - w.y) }
    if (!best) for (const a of this.actors.values()) {
      if (!a.sprite.visible || a.sprite.alpha <= 0.05 || !a.sprite.getBounds().contains(w.x, w.y)) continue
      if (!best || a.sprite.y > best.sprite.y + 0.5 || (a.sprite.y > best.sprite.y - 0.5 && off(a) < off(best))) best = a
    }
    if (best) this.args.onHover?.(this.units.get(best.uid), { left: x + 14, right: x + 14, top: y - 10, bottom: y + 10 }, true)
  }

  // ── orders (on turns) ────────────────────────────────────────────────────────────────────────

  // A press on the board: a tap once the pointer lifts where it went down (tap); by touch, held still, the card of
  // the unit under the finger instead, pinned (pressAt), and no tap.
  down (e) {
    if (e.pointerType === 'touch' ? !e.isPrimary : e.button !== 0) return
    const at = { id: e.pointerId, x: e.clientX, y: e.clientY, held: false }
    const press = e.pointerType === 'touch' ? hold(e, () => { at.held = true; this.pressAt(e.clientX, e.clientY) }) : null
    const off = () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
    const up = (m) => {
      if (m.pointerId !== at.id) return
      off()
      press?.cancel()
      if (!at.held && Math.hypot(m.clientX - at.x, m.clientY - at.y) <= TAP_SLOP) this.tap(m.clientX, m.clientY)
    }
    const cancel = (m) => { if (m.pointerId === at.id) off() }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
  }

  // The world point under viewport point (x, y).
  worldAt (x, y) {
    const r = this.game.canvas.getBoundingClientRect()
    return this.cameras.main.getWorldPoint((x - r.left) * this.scale.width / r.width, (y - r.top) * this.scale.height / r.height)
  }

  // Whether the board takes no orders now: an order's events still playing, the battle over, or the run not
  // taking them (the foes' turn resolves inside End Turn, so this is the playback).
  locked () {
    return this.waiting || !this.player.finished || this.battle.over || this.battle.phase !== 'orders' || this.ending
  }

  // A tap (redesign.md §4): with a piece selected, a target of its armed act is aimed (its numbers shown), and tapped
  // again struck; a lit tile is a move; its old tile undoes the move. Else a piece of yours is selected (again: let
  // go), anyone else's card shows, and empty ground lets go. Nothing while the playback runs or the battle is paused.
  tap (x, y) {
    if (!this.sys.isActive() || this.ending || this.paused || this.locked()) return
    const w = this.worldAt(x, y)
    const tile = tileUnder(w.x, w.y)
    const b = this.battle
    const hits = this.unitsAt(w, tile)
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    if (u) {
      const t = hits.find((x) => s.targets.has(x.uid))
      if (t) return t.uid === s.aim ? this.commit() : this.aim(t.uid)
      if (this.undoable(u) && footprint(u.from, u.size ?? 1).includes(tile) && !hits.some((x) => x !== u && alive(x))) return this.undo()
      const to = this.anchorFor(u, tile)
      if (to != null) return this.send({ type: 'move', uid: u.uid, tile: to })
    }
    const mine = hits.find((x) => alive(x) && orderable(b, x))
    if (mine) return this.select(mine.uid === s?.uid ? null : mine.uid)
    const other = hits.find(alive)
    if (other) {
      if (s) this.aim(null)
      return this.pressAt(x, y, other.uid)
    }
    this.select(null)
  }

  // The units at a world point, as a tap reads it: whoever stands on the tile under it or whose picture covers it,
  // the living first, then those whose picture is under the point, the nearest its middle first (two sharing a tile,
  // a flyer over one on the ground, are told apart by which body is tapped), then those on the tile. The fused away
  // and the risen are gone.
  unitsAt (w, tile) {
    const out = []
    for (const u of this.battle.units) {
      const a = this.actors.get(u.uid)
      if (!a || a.fade <= 0.05) continue
      const on = (footprint(u.tile, u.size ?? 1) ?? [u.tile]).includes(tile)
      const box = a.sprite.getBounds()
      const over = a.sprite.visible && box.contains(w.x, w.y)
      if (!on && !over) continue
      out.push({ u, on, over, d: Math.hypot(box.centerX - w.x, box.centerY - w.y) })
    }
    return out.sort((p, q) => alive(q.u) - alive(p.u) || q.over - p.over || (p.over ? p.d - q.d : 0) || q.on - p.on).map((x) => x.u)
  }

  // The anchor the selected piece would move to for a tap on `tile`: the tile, or for a 2×2 an anchor whose
  // footprint covers it; null outside its Move range.
  anchorFor (u, tile) {
    const r = this.sel.reach
    if (r.has(tile)) return tile
    if ((u.size ?? 1) > 1) for (const t of r.keys()) if (footprint(t, u.size).includes(tile)) return t
    return null
  }

  undoable (u) {
    return u.moved > 0 && !u.acted && endable(this.battle, u, u.from)
  }

  // Selects a piece of yours (null: none), its act armed: the one the player armed for it, else the first it may
  // use now (firstAct).
  select (uid) {
    const b = this.battle
    const u = uid == null ? null : b.byUid.get(uid)
    const same = u && this.sel?.uid === uid
    this.dropMarks()
    this.sel = u ? { uid, ability: same ? this.sel.ability : this.firstAct(u), chosen: same && this.sel.chosen, aim: null, reach: new Map(), targets: new Set() } : null
    if (u) sfx.play('select')
    this.plan()
    this.changed()
  }

  // A piece's first act to arm: its basic blow if it has a target from here, else its basic heal, else any act
  // with a target, else its basic (the Monarch's is Arise).
  firstAct (u) {
    const b = this.battle
    const list = [u.basic, u.mend, ...u.kit.filter((a) => a !== u.basic && a !== u.mend)].filter(Boolean)
    return (list.find((a) => canAct(b, u) && usable(b, u, a) && targetsFrom(b, u, a).length) ?? list[0])?.id ?? null
  }

  // The panel's act buttons: arm another act for the selected piece.
  arm (id) {
    const s = this.sel
    if (!s || this.locked()) return
    s.ability = id
    s.chosen = true
    this.aim(null)
    this.plan()
    this.changed()
  }

  // What the selection lights, from the sim (only while the board takes orders): a soft ring under every piece of
  // yours that may still act; for the selected piece its Move range (the tiles it may stand on), the tile Undo goes
  // back to, a ring under it, and under each target its armed act may take from where it stands (a foe red, an ally
  // the synergies' blue, a corpse Arise's green), the aimed one brighter. Nothing of the foes' coming turn.
  plan () {
    const g = this.planG.clear()
    if (!this.turns || this.locked()) return
    const b = this.battle
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    if (s && (!u || !alive(u) || !orderable(b, u))) this.sel = null
    const foot = (x) => posAt(x.tile, x.size ?? 1)
    const ring = (x, colour, alpha, line, grow = 0) => {
      const p = foot(x)
      const k = (x.size ?? 1) > 1 ? BIG : 1
      g.lineStyle(line, colour, alpha).strokeEllipse(p.x, p.y + 4, (58 + grow) * k, (18 + grow / 3) * k)
    }
    for (const x of b.units) {
      if (x === u || !orderable(b, x) || !canAct(b, x)) continue
      if (x === b.monarch && !x.kit.some((a) => a.shape === 'corpse' && targetsFrom(b, x, a).length)) continue
      ring(x, PARTY, 0.5, 2)
    }
    if (!this.sel) return
    s.reach = u.acted ? new Map() : reach(b, u)
    const a = u.kit.find((x) => x.id === s.ability)
    s.targets = new Set(a && canAct(b, u) && usable(b, u, a) ? targetsFrom(b, u, a).map((x) => x.uid) : [])
    const cell = (c, fill, line, colour) => {
      const box = cellsBox(tileX(c), tileX(c), tileY(c), tileY(c), 4)
      if (fill) g.fillStyle(colour, fill).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8)
      g.lineStyle(1.5, colour, line).strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8)
    }
    const cells = new Set()
    for (const t of s.reach.keys()) for (const c of footprint(t, u.size ?? 1) ?? [t]) cells.add(c)
    for (const c of cells) cell(c, 0.16, 0.5, PLAN)
    if (this.undoable(u)) for (const c of footprint(u.from, u.size ?? 1)) cell(c, 0, 0.55, 0xffffff)
    const p = foot(u)
    const k = (u.size ?? 1) > 1 ? BIG : 1
    g.fillStyle(0xffffff, 0.1).fillEllipse(p.x, p.y + 4, 70 * k, 22 * k)
    ring(u, 0xffffff, 0.95, 3, 6)
    const colour = a?.shape === 'corpse' ? DOMAIN : a && !isBlow(a) ? BOON : FOE
    for (const uid of s.targets) {
      const x = b.byUid.get(uid)
      const q = foot(x)
      const kx = (x.size ?? 1) > 1 ? BIG : 1
      g.fillStyle(colour, uid === s.aim ? 0.3 : 0.14).fillEllipse(q.x, q.y + 4, 58 * kx, 18 * kx)
      ring(x, colour, uid === s.aim ? 1 : 0.85, uid === s.aim ? 4 : 2.5, uid === s.aim ? 8 : 0)
    }
  }

  // Aims the selected piece's armed act at `uid` (null: none): what it would do, from the sim's preview (the same
  // code that deals it), in numbers over the struck and, for a melee blow answered, the counter over the striker.
  aim (uid) {
    const s = this.sel
    this.dropMarks()
    if (!s) return
    s.aim = null
    const p = uid == null ? null : preview(this.battle, s.uid, s.ability, uid)
    if (p) {
      s.aim = uid
      const hits = Object.entries(p.hits).filter(([, d]) => d > 0)
      for (const [x, d] of hits) this.mark(+x, `−${d}${+x === uid && p.kills ? ' · FALLS' : ''}`, +x === uid && p.kills ? '#ff8a9a' : '#ffe6c8')
      if (p.heal > 0) this.mark(uid, `+${p.heal}`, '#7be0a0')
      if (!hits.length && !(p.heal > 0)) this.mark(uid, abilityDef(s.ability).name, '#d8d0ff', 12)
      if (p.counter > 0) this.mark(s.uid, `↩ −${p.counter}`, '#ffb27a')
      sfx.play('click')
    }
    this.plan()
    this.changed()
  }

  // A preview's number over a unit, held until the aim changes.
  mark (uid, text, colour, size = 15) {
    const a = this.actors.get(uid)
    if (!a) return
    const z = this.cameras.main.zoom
    const t = this.text(a.vx ?? a.sprite.x, a.sprite.y - a.chest - a.hover - 24, text, labelSize(size, z, 'num'), colour, 4).setOrigin(0.5, 1).setDepth(9700)
    this.aimMarks.push(t)
  }

  dropMarks () {
    for (const t of this.aimMarks) t.destroy()
    this.aimMarks = []
  }

  // The second tap on the aimed target: the act is given.
  commit () {
    const s = this.sel
    this.send({ type: 'act', uid: s.uid, ability: s.ability, target: s.aim })
  }

  undo () {
    if (this.sel && !this.locked()) this.send({ type: 'undo', uid: this.sel.uid })
  }

  // End Turn (the panel's): the untouched act, the foes take their turn, and it all plays back.
  endTurn () {
    if (this.locked() || this.paused) return
    this.select(null)
    this.send({ type: 'end' })
  }

  fuse (o) {
    if (!this.locked()) this.send(o)
  }

  // Gives an order (args.order: the run applies it) and plays back its events; the board waits until they have
  // played (settle).
  send (o) {
    let events
    try {
      events = this.args.order(o)
    } catch (e) {
      console.warn(`order refused: ${e.message}`)
      sfx.play('poor')
      return this.plan()
    }
    this.dropMarks()
    if (this.sel) this.sel.aim = null
    this.planG.clear()
    this.waiting = true
    this.player.enqueue(events ?? [])
    this.changed()
  }

  // An order played out: the selection stays on a piece that may still do something (after a move, its act), its
  // act re-armed unless the player chose it; one that acted, fell or fused away is let go of.
  settle () {
    const s = this.sel
    const u = s && this.battle.byUid.get(s.uid)
    if (u && (!alive(u) || !orderable(this.battle, u) || u.acted)) this.sel = null
    else if (u && !s.chosen) s.ability = this.firstAct(u)
    this.plan()
    this.changed()
  }

  // Skip, on turns: every beat queued plays now.
  flush () {
    if (!this.player.finished) this.playMs = Math.max(this.playMs, this.player.end)
  }

  // The selected piece's panel for the chrome (ui.js battleChrome): its HP and Move, each act it has (a skill's rest,
  // whether it may be used now and on how many), Undo, the fusions lit beside it, and on the Monarch whether Arise is
  // held. Null with none selected.
  panel () {
    const b = this.battle
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    if (!u || !alive(u)) return null
    const free = !this.locked()
    const arise = u === b.monarch && b.relics.includes('arise')
    // The Monarch's one act is Arise, and only while the relic is held; no other piece raises.
    const mine = u === b.monarch ? (arise ? u.kit.filter((a) => a.shape === 'corpse') : []) : u.kit.filter((a) => a.shape !== 'corpse')
    const acts = mine.map((a) => {
      const can = free && canAct(b, u) && usable(b, u, a)
      return { id: a.id, name: a.name, skill: isSkill(u, a), heal: !isBlow(a), rest: u.cooldowns[a.id] ?? 0, armed: a.id === s.ability, can, targets: can ? targetsFrom(b, u, a).length : 0 }
    })
    return {
      uid: u.uid, id: u.id, monarch: u === b.monarch, hp: u.hp, maxHp: u.maxHp, move: u.move, moved: u.moved, acted: u.acted, hexed: hexed(u),
      acts, aim: s.aim != null, undo: free && this.undoable(u), arise,
      fusions: free ? legalOrders(b).filter((o) => o.type === 'fuse' && o.uid === u.uid).map((o) => ({ order: o, name: FUSIONS[o.id].name, price: b.fuse?.[o.id]?.price ?? null })) : []
    }
  }

  // ── animation ────────────────────────────────────────────────────────────────────────────────

  // Plays keyframes on a unit's pose ({ lean, sx, sy, dx, dy }; see REST). Each key tweens to `to` over
  // `ms`; as it starts, `picture` swaps the unit's picture and `start` runs. Whatever was playing gives
  // way, and a living unit goes back to its alive picture first, so a cut-off swing never sticks.
  animate (a, keys) {
    this.tweens.killTweensOf(a.pose)
    if (!a.gone) this.picture(a, 'alive')
    this.tweens.chain({
      targets: a.pose,
      tweens: keys.map((k) => ({
        ...REST, ...k.to, duration: k.ms, ease: k.ease ?? 'Sine.InOut',
        onStart: () => { if (k.picture) this.picture(a, k.picture); k.start?.() }
      }))
    })
  }

  picture (a, pose) {
    a.sprite.setTexture(`${a.skin}:${a.art}:${pose}`)
  }

  // A living unit's poses. `toward` is the other unit in the exchange (the target for an attacker, the
  // attacker for the hurt): its leans point at it.
  strike (a, pose, toward = null) {
    if (a.gone) return
    const dx = toward ? toward.sprite.x - a.sprite.x : 0
    const dy = toward ? toward.sprite.y - a.sprite.y : 0
    const len = Math.hypot(dx, dy) || 1
    const [ux, uy] = [dx / len, dy / len]
    const lean = Math.sign(dx)
    const at = (d) => ({ dx: ux * d, dy: uy * d })
    switch (pose) {
      // Wind up, snap into the attack picture, hold the blow, recover.
      case 'attack': return this.animate(a, [
        { to: { lean: -8 * lean, sx: 0.08, sy: -0.1, ...at(-4) }, ms: 90, ease: 'Quad.Out' },
        { to: { lean: 10 * lean, sx: -0.06, sy: 0.1, ...at(6) }, ms: 80, ease: 'Back.Out', picture: 'attack' },
        { to: { lean: 8 * lean, sx: -0.02, sy: 0.04, ...at(4) }, ms: 160 },
        { to: REST, ms: 200, picture: 'alive' }])
      // Gather, rise into the release, hold it while the spell flies.
      case 'cast': return this.animate(a, [
        { to: { lean: -4 * lean, sx: 0.06, sy: -0.07 }, ms: 160, ease: 'Quad.Out' },
        { to: { lean: 6 * lean, sx: -0.04, sy: 0.12, dy: -4 }, ms: 100, ease: 'Back.Out', picture: 'attack' },
        { to: { lean: 4 * lean, sy: 0.06, dy: -3 }, ms: 260 },
        { to: REST, ms: 200, picture: 'alive' }])
      // Knocked back from the blow, squashed, then springing back.
      case 'hurt': return this.animate(a, [
        { to: { lean: -12 * lean, sx: 0.1, sy: -0.12, ...at(-7) }, ms: 60, ease: 'Quad.Out' },
        { to: REST, ms: 240, ease: 'Back.Out' }])
      case 'idle': return this.animate(a, [{ to: REST, ms: 140 }])
    }
  }

  // A step to the next tile, hopping; whatever tween was moving the sprite (an entrance, a step) gives way. On turns
  // a move walks its whole path (ev.path), a hop a tile, STEP_MS each; an undo goes straight back.
  walk (ev) {
    const a = this.actors.get(ev.actor)
    if (!a || a.gone) return
    const path = ev.type === 'move' && ev.path?.length ? ev.path : [ev.to]
    a.tile = ev.to
    a.home = posAt(ev.to, a.fp)
    this.halt(a)
    const ms = this.turns ? STEP_MS : WALK_MS
    const lean = Math.sign(a.home.x - a.sprite.x) || 1
    if (path.length === 1) this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: ms, ease: 'Sine.InOut' })
    else {
      const points = [{ x: a.sprite.x, y: a.sprite.y }, ...path.map((t) => posAt(t, a.fp))]
      a.walker = this.tweens.addCounter({
        from: 0, to: path.length, duration: ms * path.length,
        onUpdate: (tw) => {
          const v = tw.getValue()
          const i = Math.min(path.length - 1, Math.floor(v))
          const f = v - i
          a.sprite.setPosition(points[i].x + (points[i + 1].x - points[i].x) * f, points[i].y + (points[i + 1].y - points[i].y) * f)
        }
      })
    }
    this.animate(a, path.flatMap(() => [
      { to: { lean: 5 * lean, sy: 0.05, dy: -7 }, ms: ms * 0.4, ease: 'Sine.Out' },
      { to: { lean: -2 * lean, sx: 0.06, sy: -0.07 }, ms: ms * 0.4, ease: 'Sine.In' },
      { to: REST, ms: ms * 0.2 }]))
  }

  // Whatever is moving a unit's sprite stops where it is (a walk along a path, a glide, a step).
  halt (a) {
    a.walker?.stop()
    a.walker = null
    this.tweens.killTweensOf([a.sprite, a])
  }

  // A flyer that falls comes down to the ground.
  drop (a) {
    if (a.hover) this.tweens.add({ targets: a, hover: 0, duration: 260, ease: 'Quad.In' })
  }

  // Death: the unit staggers back from its killer and topples over at the feet; where it hits the ground
  // it becomes its corpse in a puff of dust, its soul leaves, and the corpse stays under the living.
  fall (a, killer) {
    a.gone = true
    this.drop(a)
    // Its bars empty with it (as a crumble's do), whatever older event set them last: a fallen unit keeps no
    // HP under its faded bar, for Undying to show again.
    a.hp = 0
    a.bar.width = 0
    this.tweens.killTweensOf(a.trail)
    this.tweens.add({ targets: a.trail, width: 0, duration: 300, ease: 'Quad.Out' })
    if (a.uid === this.monarch) this.crownHp(a)
    a.gaugeBar.width = 0
    a.ring.setVisible(false)
    this.picture(a, 'alive')
    // A unit can die mid-step: it is sent the rest of the way to its tile now.
    a.walker?.stop()
    this.tweens.killTweensOf(a.sprite)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: 200, ease: 'Sine.Out' })
    const away = killer ? Math.sign(a.sprite.x - killer.sprite.x) || (a.uid % 2 ? 1 : -1) : 1
    const land = () => {
      a.sprite.setTint(0xc4bfd0)
      this.dust.explode(14, a.home.x, a.home.y - 4)
      if (this.heavy(a.uid)) this.shake(90, 0.0025)
      this.wisp(a)
    }
    this.animate(a, [
      { to: { lean: 10 * away, sx: 0.06, sy: -0.08, dx: 6 * away }, ms: 130, ease: 'Quad.Out' },
      { to: { lean: 84 * away, sy: -0.06, dx: 4 * away }, ms: 300, ease: 'Quad.In' },
      { to: { sx: 0.12, sy: -0.2 }, ms: 1, picture: 'dead', start: land },
      { to: REST, ms: 280, ease: 'Back.Out' }])
    this.tweens.add({ targets: this.parts(a), alpha: 0, duration: 300 })
  }

  // What stands beside a unit's picture: its bars, its pool of shadow, its growth.
  parts (a) {
    return [a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow, ...(a.pips ?? []), ...(a.growth?.parts ?? [])].filter(Boolean)
  }

  // The Sovereign has fallen, and every foe left crumbles to dust where it stands, out from it like a ripple,
  // the nearest first: no blow before, so its bar empties at once. Their souls stream to you (they pay as if
  // slain); a foe's shadow just goes. The first to crumble sends a shudder out from the Sovereign.
  crumble (a, boss) {
    if (!this.crumbling && boss) {
      this.crumbling = true
      const wave = this.add.image(boss.sprite.x, boss.sprite.y - boss.chest, 'glow').setTint(ROT).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(40, 40).setAlpha(0.9).setDepth(9300)
      this.tweens.add({ targets: wave, displayWidth: 900, displayHeight: 520, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => wave.destroy() })
      this.flashScreen(260, 70, 40, 90)
      this.shake(320, 0.006)
    }
    a.gone = true
    a.hp = 0
    this.drop(a)
    a.gaugeBar.width = 0
    a.bar.width = 0
    a.ring.setVisible(false)
    a.walker?.stop()
    this.tweens.killTweensOf([a.sprite, a.trail])
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: 200, ease: 'Sine.Out' })
    this.tweens.add({ targets: a.trail, width: 0, duration: 300, ease: 'Quad.Out' })
    const far = boss ? Math.hypot(a.home.x - boss.sprite.x, a.home.y - boss.sprite.y) : 0
    const delay = Math.min(900, 120 + far * 1.4)
    this.holdUntil = Math.max(this.holdUntil, this.playMs + delay + 900)
    this.animate(a, [
      { to: {}, ms: delay },
      { to: { sx: 0.12, sy: -0.1 }, ms: 140, ease: 'Quad.Out', start: () => { a.sprite.setTint(0x8a8094); this.burst(a.home.x, a.home.y - a.chest, 0xb8a8c8, 10, { up: true, speed: 60 }) } },
      { to: { sx: 0.34, sy: -0.94 }, ms: 640, ease: 'Quad.In', start: () => { this.dust.explode(18, a.home.x, a.home.y - 6); if (!a.shade) this.wisp(a) } }])
    this.tweens.add({ targets: a, fade: 0, delay: delay + 320, duration: 700, ease: 'Quad.In' })
    this.tweens.add({ targets: this.parts(a), alpha: 0, delay, duration: 400 })
  }

  // Arise: the beam reaches the corpse, the corpse sinks away, and its shadow climbs out of the ground where it
  // lay in a ring of pale light, then glides, a wisp trailing it, to the tile it rises on (DESIGN §2.5: the free
  // tile nearest the Monarch; `from` is the corpse's). It runs as the beam is cast, not at its impact, because the
  // shadow may step or act within a few ticks: a step takes the glide over from wherever it has got to (walk). The
  // Sovereign's Grave Tide raises the field's dead the same way on the foes' side, in a bruised-rose light, and so
  // does a Legion there. The Legion (Undead 8, `ev.rule`) raises with no beam and no actor (ev.actor may be null),
  // the moment its corpse falls: it waits for the fall to land.
  arise (ev) {
    const LAND = ev.rule === 'legion' ? 620 : 340
    const glow = ev.unit.side === 'foe' ? ROT : RISE
    this.units.set(ev.unit.uid, this.battle.units.find((x) => x.uid === ev.unit.uid))
    const corpse = this.actors.get(ev.corpse)
    if (corpse) {
      corpse.sprite.disableInteractive()
      this.tweens.add({ targets: corpse, fade: 0, delay: LAND - 60, duration: 420, ease: 'Quad.In' })
    }
    this.addActor(ev.unit)
    const a = this.actors.get(ev.unit.uid)
    const from = ev.from != null && ev.from !== ev.unit.tile ? posOf(ev.from) : null
    const at = from ?? a.home
    if (from) a.sprite.setPosition(from.x, from.y)
    a.rise.v = 0
    a.pose = { ...REST, sx: -0.3, sy: -0.75 }
    for (const part of this.parts(a)) part.setAlpha(0)
    this.tweens.add({ targets: a.rise, v: 1, delay: LAND, duration: 520, ease: 'Sine.Out' })
    this.tweens.add({ targets: [a.bar, a.trail, a.barBg, a.gaugeBar], alpha: 1, delay: LAND + 300, duration: 300 })
    this.tweens.add({ targets: a.shadow, alpha: 1, delay: LAND, duration: 400 })
    this.animate(a, [
      { to: { sx: -0.3, sy: -0.75 }, ms: LAND },
      { to: { sx: 0.08, sy: 0.1, dy: -6 }, ms: 380, ease: 'Back.Out' },
      { to: REST, ms: 260 }])
    const ring = this.add.image(at.x, at.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(30, 10).setAlpha(0).setDepth(at.y - 1)
    this.tweens.add({
      targets: ring, displayWidth: 120, displayHeight: 34, alpha: { from: 0.9, to: 0 }, delay: LAND, duration: 700, ease: 'Cubic.Out',
      onStart: () => this.burst(at.x, at.y - 4, glow, 16, { up: true, speed: 90 }),
      onComplete: () => ring.destroy()
    })
    if (!from) return
    // The glide: longer the further it goes, never long; a wisp trails it, stopped on time whatever cuts it short.
    const go = LAND + 520
    const ms = Math.min(900, 380 + 70 * Math.hypot(a.home.x - from.x, a.home.y - from.y) / TILE_W)
    const trail = this.add.particles(0, 0, 'spark', {
      emitting: false, lifespan: 460, speed: 10, scale: { start: 0.55, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: glow, frequency: 22, blendMode: 'ADD'
    }).setDepth(9399)
    trail.startFollow(a.sprite, 0, -a.chest)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, delay: go, duration: ms, ease: 'Sine.InOut', onStart: () => trail.start() })
    this.time.delayedCall(go + ms, () => {
      trail.stop()
      this.time.delayedCall(600, () => trail.destroy())
      if (!a.gone) this.burst(a.sprite.x, a.sprite.y - 4, glow, 8, { up: true, speed: 50 })
    })
  }

  // A unit enters a battle under way: a foe of a later wave comes in over the far edge (see arrive); one of
  // yours fades in out of the dark in a soft ring of soulfire. It plays at once, not at an action's impact: it
  // may step or act within the same tick.
  enter (ev) {
    this.units.set(ev.unit.uid, this.battle.byUid.get(ev.unit.uid) ?? this.battle.units.find((x) => x.uid === ev.unit.uid))
    this.addActor(ev.unit)
    const a = this.actors.get(ev.unit.uid)
    const glow = ev.unit.side === 'foe' ? FOE : SOUL
    a.rise.v = 0
    for (const part of this.parts(a)) part.setAlpha(0)
    if (ev.unit.side === 'foe') return this.arrive(a)
    this.tweens.add({ targets: a.rise, v: 1, duration: 420, ease: 'Sine.Out' })
    this.tweens.add({ targets: this.parts(a), alpha: 1, delay: 200, duration: 300 })
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(90, 26).setAlpha(0.7).setDepth(a.home.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 30, displayHeight: 10, alpha: 0, duration: 520, ease: 'Cubic.In', onComplete: () => ring.destroy() })
    this.burst(a.home.x, a.home.y - 4, glow, 8, { up: true, speed: 50 })
  }

  // A foe of a later wave comes in out of the dark past the far (left) edge onto its tile in a few hops, a red
  // glow where it lands. A step it takes meanwhile carries it on from wherever it has got to (see walk).
  arrive (a) {
    const MS = 560
    a.sprite.setX(a.home.x - TILE_W * 1.3)
    this.tweens.add({ targets: a.rise, v: 1, duration: MS * 0.6, ease: 'Sine.Out' })
    this.tweens.add({ targets: a.sprite, x: a.home.x, duration: MS, ease: 'Sine.Out' })
    this.tweens.add({ targets: this.parts(a), alpha: 1, delay: MS * 0.6, duration: 300 })
    this.animate(a, [
      { to: { sy: 0.05, dy: -8 }, ms: MS * 0.25, ease: 'Sine.Out' },
      { to: { sx: 0.05, sy: -0.06 }, ms: MS * 0.25, ease: 'Sine.In' },
      { to: { sy: 0.05, dy: -6 }, ms: MS * 0.25, ease: 'Sine.Out' },
      { to: { sx: 0.08, sy: -0.08 }, ms: MS * 0.15, ease: 'Sine.In' },
      { to: REST, ms: MS * 0.1 }])
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(FOE).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(30, 10).setAlpha(0).setDepth(a.home.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 90, displayHeight: 26, alpha: { from: 0.6, to: 0 }, delay: MS * 0.7, duration: 500, ease: 'Cubic.Out', onComplete: () => ring.destroy() })
  }

  // A foe wave arrives (sim event `wave`, just before its first foe enters): its name over the top of the board,
  // and a red glow down the far (left) edge. A later wave, or the Sovereign and its court.
  waveBanner (k) {
    const w = this.waves[k]
    const title = w?.boss ? 'THE HOLLOW SOVEREIGN COMES' : `THE ${ORDINAL[k] ?? `${k + 1}TH`} WAVE`
    const sub = w ? `${w.size} ${w.size === 1 ? 'foe enters' : 'foes enter'} from the far edge${w.boss ? ', its court about it' : ''}` : 'More foes enter from the far edge'
    const edge = this.add.image(-HALF_W - TILE_W / 2, 0, 'glow').setTint(FOE).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(46, 2 * HALF_H + 160).setAlpha(0).setDepth(-350)
    this.tweens.add({ targets: edge, alpha: { from: 0.75, to: 0 }, duration: 1800, ease: 'Quad.In', onComplete: () => edge.destroy() })
    const y = -HALF_H + TILE_H * 0.9
    // Its two lines legible at the zoom (labelSize), the plate round them.
    const z = this.cameras.main.zoom
    const head = this.text(0, 0, title, labelSize(17, z), '#ff8a9a', 4, faceFor(17, z)).setOrigin(0.5, 0).setDepth(9600).setAlpha(0)
    const line = this.text(0, 0, sub, labelSize(10, z), '#c09aa4', 0).setOrigin(0.5, 0).setDepth(9600).setAlpha(0)
    const ph = head.height + line.height + 12
    head.setY(y - ph / 2 + 5)
    line.setY(head.y + head.height + 1)
    const plate = this.add.rectangle(0, y, Math.max(HALF_W, head.width + 40, line.width + 40), ph, 0x07060b, 0.84).setStrokeStyle(1, FOE, 0.45).setDepth(9590).setAlpha(0)
    this.tweens.add({ targets: [plate, head, line], alpha: 1, duration: 200 })
    this.tweens.add({ targets: [plate, head, line], alpha: 0, delay: 1700, duration: 500, onComplete: () => { plate.destroy(); head.destroy(); line.destroy() } })
    this.shake(180, 0.003)
  }

  // On turns: a turn of yours begins. Its counts go to the chrome, and its number shows a moment over the board.
  newTurn (ev) {
    this.clock = { turn: ev.turn, cap: ev.cap, next: ev.next }
    this.changed()
    this.flag(`TURN ${ev.turn}`, C.soul2, SOUL)
  }

  // A word across the middle of the board a moment (a turn, the foes' turn), on a dark plate in its side's colour;
  // the last one gives way to the next.
  flag (word, colour, edge) {
    this.flagged?.forEach((o) => o.destroy())
    const z = this.cameras.main.zoom
    const t = this.text(0, 0, word, labelSize(16, z), colour, 4, faceFor(16, z)).setOrigin(0.5).setDepth(9600).setAlpha(0)
    const plate = this.add.rectangle(0, 0, t.width + 48, t.height + 14, 0x07060b, 0.8).setStrokeStyle(1, edge, 0.5).setDepth(9590).setAlpha(0)
    this.flagged = [plate, t]
    this.tweens.add({ targets: this.flagged, alpha: 1, duration: 140 })
    this.tweens.add({ targets: this.flagged, alpha: 0, delay: 650, duration: 300, onComplete: () => { plate.destroy(); t.destroy() } })
  }

  // On turns, a fusion in battle: its parts are drawn into the fuser's tile and go, and the fused piece rises there
  // out of soulfire (enter).
  fused (ev) {
    const at = posAt(ev.unit.tile, ev.unit.size ?? 1)
    for (const uid of ev.parts) {
      const p = this.actors.get(uid)
      if (!p) continue
      p.gone = true
      this.halt(p)
      p.ring.setVisible(false)
      p.sprite.disableInteractive()
      this.tweens.add({ targets: p.sprite, x: at.x, y: at.y, duration: 360, ease: 'Quad.In' })
      this.tweens.add({ targets: p, fade: 0, duration: 420, ease: 'Quad.In' })
      this.tweens.add({ targets: this.parts(p), alpha: 0, duration: 260 })
    }
    this.burst(at.x, at.y - 20, SOUL, 18, { up: true, speed: 90 })
    sfx.play('arise')
    this.time.delayedCall(300, () => this.enter({ unit: ev.unit }))
  }

  // A foe slain in a battle of waves: its essence goes to its wave's tally, and once the whole wave is slain
  // (or the battle ends, for one cut short by the Sovereign's fall) a popup says what that wave paid, relics
  // included, before the purse rounds the battle's total. Shadows pay nothing.
  slain (a) {
    if (a.side !== 'foe' || a.shade || this.waves.length < 2) return
    const u = this.units.get(a.uid)
    const k = u?.wave ?? 0
    const w = this.waves[k]
    if (!w) return
    w.paid += foeEssence(u) * this.essence
    if (--w.left <= 0) this.wavePaid(k)
  }

  wavePaid (k) {
    const w = this.waves[k]
    if (!w || w.shown || w.paid <= 0) return
    w.shown = true
    const name = `WAVE ${k + 1}`
    // Popups shown together stack down the board's middle.
    const now = this.playMs
    this.payStack = now - (this.payAt ?? -1e9) < 900 ? (this.payStack ?? 0) + 1 : 0
    this.payAt = now
    const size = labelSize(12, this.cameras.main.zoom)
    const y = -TILE_H + this.payStack * size * 1.6
    const from = Math.min(1, Math.max(0.6, labelPx('word') / (size * this.cameras.main.zoom)))
    const t = this.text(0, y, `${name} SLAIN · +${Math.round(w.paid)} ESSENCE`, size, C.soul2, 3).setOrigin(0.5).setDepth(9550).setScale(from)
    if (from < 1) this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' })
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, delay: 1300, duration: 900, ease: 'Quad.Out', onComplete: () => t.destroy() })
    this.burst(0, y, SOUL, 12, { up: true, speed: 70 })
  }

  // ── the board, statuses, HP and essence ──────────────────────────────────────────────────────

  // Burning and Hexed, worn while held (DESIGN §4), read from the unit each frame: flames licking up a burning
  // picture, quicker for each stack, and a violet pall over a hexed one; on turns every other status a fainter pall
  // in its def's colour (palls). Gone with the status, or the unit. The flames keep the playback clock, so pause
  // holds them.
  wear (a, u) {
    const held = (id) => (!a.gone && u?.hp > 0 && u.statuses?.find((x) => x.id === id)) || null
    const burn = held('burning')
    const top = a.sprite.y - a.hover - a.up - a.chest + a.fly
    if (burn && this.playMs >= (a.nextFlame ?? 0)) {
      a.nextFlame = this.playMs + (calm ? 360 : [110, 75, 50][Math.min(3, burn.stacks ?? 1) - 1])
      const w = a.sprite.displayWidth * 0.26
      this.flames.explode(1, a.vx + (Math.random() * 2 - 1) * w, top + (a.chest - a.fly) * (0.1 + Math.random() * 0.7))
    }
    if (this.turns) this.palls(a, u, top)
    const hexed = !!held('hexed')
    if (hexed && !a.pall) a.pall = this.add.image(0, 0, 'glow').setTint(HEX).setBlendMode(Phaser.BlendModes.ADD)
    if (!a.pall) return
    a.pall.setVisible(hexed)
    if (!hexed) return
    const pulse = calm ? 0.5 : 0.42 + 0.12 * Math.sin(this.playMs / 300 + a.uid)
    a.pall.setPosition(a.vx, top).setDisplaySize(a.sprite.displayWidth * 0.95, a.sprite.displayHeight * 0.85)
      .setDepth(a.sprite.depth + 0.2).setAlpha(pulse * a.fade * a.rise.v)
  }

  // On turns (redesign.md §2.8): each status held but the two drawn their own way, a pall in its colour, faint and
  // layered a little lower and narrower each, made as it lands and gone with it.
  palls (a, u, top) {
    const want = !a.gone && u?.hp > 0 ? u.statuses.filter((x) => x.id !== 'hexed' && x.id !== 'burning' && statusDef(x.id).colour) : []
    if (!want.length && !a.palls?.size) return
    a.palls ??= new Map()
    for (const [id, img] of a.palls) if (!want.some((x) => x.id === id)) { img.destroy(); a.palls.delete(id) }
    want.forEach((x, i) => {
      let img = a.palls.get(x.id)
      if (!img) a.palls.set(x.id, img = this.add.image(0, 0, 'glow').setTint(hex(statusDef(x.id).colour)).setBlendMode(Phaser.BlendModes.ADD))
      const pulse = calm ? 0.3 : 0.27 + 0.08 * Math.sin(this.playMs / 340 + a.uid + i)
      img.setPosition(a.vx, top + 6 * i).setDisplaySize(a.sprite.displayWidth * (0.9 - 0.12 * i), a.sprite.displayHeight * (0.8 - 0.1 * i))
        .setDepth(a.sprite.depth + 0.1).setAlpha(pulse * a.fade * a.rise.v)
    })
  }

  decorate (start) {
    drawGround(this)
    // The camp's walls, and a rune under every other tile, in its side's colour; the tiles the battle starts on glow
    // (not on turns, where the pieces move off them).
    const g = this.add.graphics().setDepth(-400)
    const zone = (y) => (y < CAMP_ROWS ? PARTY : y >= DEPTH - ROWS ? FOE : NEUTRAL)
    const walls = new Set(start.walls)
    for (const tile of walls) {
      const p = posOf(tile)
      // One of the wall pictures, picked by the tile so a camp always looks the same.
      this.add.image(p.x, p.y + 8, WALLS[(tile * 7 + (tile >> 3)) % WALLS.length]).setOrigin(0.5, WALL_FOOT)
        .setScale(WALL_SCALE / RES).setFlipX(tile % 2 === 1).setDepth(p.y)
    }
    const occupied = new Set(this.turns ? [] : start.units.flatMap((u) => footprint(u.tile, u.size ?? 1) ?? [u.tile]))
    for (let tile = 0; tile < TILES; tile++) {
      if (walls.has(tile)) continue
      const p = posOf(tile)
      const colour = zone(tileY(tile))
      const on = occupied.has(tile)
      g.lineStyle(1.2, colour, on ? 0.5 : 0.14).strokeEllipse(p.x, p.y + 6, 50, 15)
      if (on) this.add.image(p.x, p.y + 6, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(70, 22).setAlpha(0.3).setDepth(-380)
    }
    // The words (their title and synergies, yours, the Monarch's HP) stand in the page's chrome (args.hud).
    const syn = (side) => topSteps(start.synergies.filter((s) => s.side === side).map((s) => s.id))
    this.args.hud?.start({ title: this.args.title ?? `FLOOR ${this.battle.floor}`, theirs: syn('foe'), mine: syn('party'), monarch: start.monarch != null })
    const m = start.units.find((u) => u.uid === start.monarch)
    if (!m) return
    // The domain only while the run holds the Arise relic (battle.held.arise): without it the domain does nothing.
    if (this.battle.held?.arise > 0) this.drawDomain(m.tile)
    this.crownHp(m)
  }

  // Arise's reach (the domain): every tile within `this.domain` of `centre` (the Monarch's), clipped to the board.
  drawDomain (centre) {
    const box = ringBox(centre, this.domain, 4)
    const d = this.add.graphics().setDepth(-395)
    d.fillStyle(DOMAIN, 0.035).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 12)
    d.lineStyle(1.5, DOMAIN, 0.4).strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 12)
    // Just outside the box, on a dark plate (as the prep board's: board.js drawDomain), over the units (no body
    // cuts it), at whichever corner covers fewest of them (placeDomain).
    const label = domainLabel(this, this.domain).setDepth(7000)
    legible(label, this.cameras.main.zoom, 'word')
    ;(this.small ??= []).push(label)
    this.domLabel = { t: label, box }
    this.placeDomain()
  }

  // The domain's caption, outside its box where it covers the fewest bodies and bars standing now, inside the
  // room the camera keeps (fit: placed again when the zoom rescales it).
  placeDomain () {
    const d = this.domLabel
    if (!d?.t.active) return
    const blocked = []
    for (const a of this.actors?.values() ?? []) {
      if (a.gone) continue
      const s = a.sprite.getBounds()
      blocked.push({ l: s.x + s.width * 0.15, r: s.right - s.width * 0.15, t: s.y, b: a.sprite.y + BAR_DROP + 8 })
    }
    placeOutside(d.t, d.box, BOX, blocked)
  }

  // Undying: a piece that just fell is up again at once, on its own tile. Its fall is cut short: it slumps
  // and springs back up in a ring of warm light, its bars back under it.
  rise (a, ev) {
    a.gone = false
    a.hp = ev.hp
    if (a.fly) this.tweens.add({ targets: a, hover: a.fly, duration: 300, ease: 'Sine.Out' })
    this.tweens.killTweensOf([a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow])
    for (const part of [a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow]) part.setAlpha(1)
    a.bar.width = a.trail.width = BAR * Math.max(0, a.hp / a.maxHp)
    a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY)
    // Its growth, faded with its fall: back with it.
    for (const part of a.growth?.parts ?? []) {
      this.tweens.killTweensOf(part)
      part.setAlpha(1)
    }
    const away = a.uid % 2 ? 1 : -1
    this.animate(a, [
      { to: { lean: 40 * away, sx: 0.08, sy: -0.22, dy: 4 }, ms: 180, ease: 'Quad.Out' },
      { to: { sx: -0.06, sy: 0.16, dy: -10 }, ms: 300, ease: 'Back.Out' },
      { to: REST, ms: 240 }])
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(UNDYING).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(30, 10).setAlpha(0.9).setDepth(a.home.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 110, displayHeight: 32, alpha: 0, delay: 120, duration: 620, ease: 'Cubic.Out', onComplete: () => ring.destroy() })
    this.burst(a.home.x, a.home.y - 4, UNDYING, 14, { up: true, speed: 80 })
    this.floating(a, 'RISES', C.legendary, 13)
  }

  // An HP bar set from an event (Blood Tithe's cost): the trail follows a loss, a gain snaps it.
  // `seq` as in applyEvent: an older event than the last shown leaves the bars as they are.
  setHp (a, hp, seq) {
    if (seq < a.seq) return
    if (seq !== undefined) a.seq = seq
    const down = hp < a.hp
    a.hp = hp
    if (a.uid === this.monarch) this.crownHp(a)
    const w = BAR * Math.max(0, a.hp / a.maxHp)
    a.bar.width = w
    this.tweens.killTweensOf(a.trail)
    if (down) this.tweens.add({ targets: a.trail, width: w, delay: 260, duration: 380, ease: 'Quad.Out' })
    else a.trail.width = w
  }

  // The chrome's Monarch HP (args.hud), from its actor (or the start unit).
  crownHp (a) {
    this.args.hud?.hp(Math.max(0, a.hp), a.maxHp)
  }

  // A burst of sparks in one colour; one emitter per colour, made on first use.
  burst (x, y, colour, n = 10, { up = false, speed = 140 } = {}) {
    const key = `${colour}|${up}`
    let e = this.emitters.get(key)
    if (!e) {
      e = this.add.particles(0, 0, 'spark', {
        emitting: false,
        lifespan: up ? 700 : 420,
        speed: { min: speed * 0.3, max: speed },
        angle: up ? { min: 240, max: 300 } : { min: 0, max: 360 },
        gravityY: up ? -60 : 160,
        scale: { start: up ? 0.7 : 0.9, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: colour,
        blendMode: 'ADD'
      }).setDepth(9300)
      this.emitters.set(key, e)
    }
    e.explode(n, x, y)
  }

  // A soul leaves the fallen: foes' souls stream toward you, your own fade upward.
  // Under reduced motion no soul flies: a slain foe's essence lands on the purse at once.
  wisp (a) {
    const mine = a.side === 'party'
    if (calm) {
      if (!mine && a.worth) {
        this.purse = Math.min(this.owed, this.purse + a.worth)
        a.worth = 0
        sfx.play('essence')
        this.changed()
      }
      return
    }
    const orb = this.add.image(a.sprite.x, a.sprite.y - a.chest, 'glow').setTint(mine ? 0xb8b4c8 : SOUL).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45).setDepth(9400)
    const trail = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: 6, scale: { start: 0.5, end: 0 }, alpha: { start: 0.8, end: 0 },
      tint: mine ? 0xb8b4c8 : SOUL, frequency: 30, blendMode: 'ADD'
    }).setDepth(9399)
    trail.startFollow(orb)
    const done = () => { trail.stopFollow(); trail.stop(); orb.destroy(); this.time.delayedCall(600, () => trail.destroy()) }
    if (mine) {
      this.tweens.add({ targets: orb, y: orb.y - 70, alpha: 0, scale: 0.2, duration: 1300, ease: 'Sine.Out', onComplete: done })
    } else if (a.worth) {
      // A slain foe's essence (see pay): its soul arcs down to the counter in the playback bar, which ticks up
      // as it lands (the Bloons TD purse).
      // Kept a readable size on screen however far the camera has zoomed out.
      const to = this.purseSpot()
      const k = Math.min(2, 1 / this.cameras.main.zoom)
      orb.setTint(0xb8fff0).setScale(0.5 * k)
      this.tweens.chain({
        targets: orb,
        tweens: [
          { y: orb.y - 34, scale: 0.85 * k, duration: 300, ease: 'Sine.Out' },
          { x: { value: to.x, ease: 'Sine.InOut' }, y: { value: to.y, ease: 'Back.In' }, scale: 0.55 * k, duration: 760 }
        ],
        onComplete: () => {
          this.purse = Math.min(this.owed, this.purse + a.worth)
          a.worth = 0
          this.burst(orb.x, orb.y, SOUL, 6, { up: true, speed: 60 })
          sfx.play('essence')
          this.changed()
          done()
        }
      })
    } else {
      this.tweens.chain({
        targets: orb,
        tweens: [
          { y: orb.y - 30, scale: 0.6, duration: 380, ease: 'Sine.Out' },
          { x: HALF_W + 120, y: 0, scale: 0.25, alpha: 0.2, duration: 900, ease: 'Cubic.In' }
        ],
        onComplete: done
      })
    }
  }

  // A foe slain (not a shadow) carries essence, the relics' share included: owed at once, counted on the bar
  // as its orb lands (see wisp), and all of it once the battle ends.
  pay (a) {
    if (a.side !== 'foe' || a.shade || a.paid) return
    const u = this.units.get(a.uid)
    if (!u) return
    a.paid = true
    a.worth = foeEssence(u) * this.essence
    this.owed += a.worth
  }

  // The counter in the playback bar, in world space (the bar lies over the canvas); else below the camp.
  purseSpot () {
    const r = this.purseAt?.()
    if (!r?.width) return { x: HALF_W + 120, y: 0 }
    const p = this.cameras.main.getWorldPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { x: p.x, y: p.y }
  }

  // ── react to events the sim already decided ──────────────────────────────────────────────────

  // `seq`: the event's place in the battle's stream (TimelinePlayer), for the HP shown.
  applyEvent (ev, inAction, seq) {
    if (ev.type === 'move' || ev.type === 'undo') return this.walk(ev)
    if (ev.type === 'arise') { sfx.play('arise'); return this.arise(ev) }
    if (ev.type === 'enter') return this.enter(ev)
    // The opening formation is wave 1 but stands there from the start: only a later wave is announced.
    if (ev.type === 'wave') { this.changed(); return ev.wave > 0 ? this.waveBanner(ev.wave) : undefined }
    // On turns: a turn of yours begins (its counts for the chrome), the foes' turn begins, a fusion in battle.
    if (ev.type === 'turn') return this.newTurn(ev)
    if (ev.type === 'stage') return ev.stage === 'foes' ? this.flag('THE FOES\' TURN', '#ff8a9a', FOE) : undefined
    if (ev.type === 'fuse') return this.fused(ev)
    if (ev.type === 'action') {
      // A counter: the struck answers at once, and says so over itself.
      if (ev.counter) { const x = this.actors.get(ev.actor); if (x) this.floating(x, 'COUNTER', '#ffb27a', 11) }
      return this.reshaped(ev, this.actors.get(ev.actor))
    }
    if (ev.type === 'rule') return this.rule(ev)
    // A trigger relic fired for this unit: its name flashes over it (its effects follow as their own events).
    if (ev.type === 'trigger') {
      const x = this.actors.get(ev.unit)
      if (!x) return
      this.floating(x, relicDef(ev.relic).name, C.relic, 11)
      this.burst(x.sprite.x, x.sprite.y - x.chest, hex(C.relic), 6, { up: true, speed: 50 })
      return
    }
    const a = ev.target != null ? this.actors.get(ev.target) : null
    if (!a) return
    switch (ev.type) {
      case 'damage':
      case 'heal': {
        // The HP shown is the newest the sim reached: an Echo's second pass shows a beat late (echoed), after
        // later blows may have, so an older event only flinches and pops, and leaves the bars as they are.
        if (!(seq < a.seq)) {
          a.seq = seq
          a.hp = ev.hp
          if (a.uid === this.monarch) this.crownHp(a)
        }
        const w = BAR * Math.max(0, a.hp / a.maxHp)
        a.bar.width = w
        this.tweens.killTweensOf(a.trail)
        if (ev.type === 'damage') {
          this.tweens.add({ targets: a.trail, width: w, delay: 260, duration: 380, ease: 'Quad.Out' })
          if (ev.isCrit) this.deadeye(ev, a)
          if (ev.damage > 0) {
            // Knocked back from the attacker; a tick of poison or burn has no attacker to face, so it shudders.
            this.strike(a, 'hurt', inAction ? this.actors.get(ev.actor) : null)
            this.flash(a)
            this.burst(a.sprite.x, a.sprite.y - a.chest, tint(ev.ability), ev.isCrit ? 22 : 9, { speed: ev.isCrit ? 220 : 140 })
            // A crit shakes; so does the Monarch struck, at most once a second (a mob on it is not a quake).
            if (ev.isCrit) { this.shake(140, 0.005); this.hitStop(55) } else if (a.uid === this.monarch && !(this.playMs - this.monarchShook < 1000)) {
              this.monarchShook = this.playMs
              this.shake(120, 0.003)
            }
            // The Monarch struck has its own, heavier sound: if it falls, the run ends.
            sfx.play(a.uid === this.monarch ? 'monarchHit' : ev.isCrit ? 'crit' : 'hit')
          }
        } else {
          a.trail.width = w
          if (ev.heal > 0) this.burst(a.sprite.x, a.sprite.y - 6, 0x7be0a0, 8, { up: true, speed: 50 })
          if (!inAction && ev.heal > 0) this.floating(a, `+${ev.heal}`, '#7be0a0')
        }
        break
      }
      case 'death': {
        this.pay(a)
        if (ev.crumble) this.crumble(a, this.actors.get(ev.actor))
        else this.fall(a, this.actors.get(ev.actor))
        this.slain(a)
        sfx.play('kill')
        // A piece of yours, a boss or the Monarch falling holds the frame (heavy), a boss or the
        // Monarch the longest.
        if (!ev.crumble && this.heavy(a.uid)) {
          const u = this.units.get(a.uid)
          this.hitStop(unitDef(u.id).boss || u.uid === this.monarch ? 150 : 80)
        }
        break
      }
      // Undying: the piece that just fell stands again.
      case 'rise':
        if (!(seq < a.seq)) a.seq = seq
        this.rise(a, ev)
        break
      // Blood Tithe: the Monarch pays for a shadow with its own HP.
      case 'tithe':
        this.setHp(a, ev.hp, seq)
        this.floating(a, `−${ev.damage} tithe`, TITHE, 11)
        this.burst(a.sprite.x, a.sprite.y - a.chest, 0xc0304a, 8, { up: true, speed: 40 })
        break
      // A status in its keyword's colour: a debuff the foes' red, a buff the synergies' blue; beside the unit,
      // apart from the numbers.
      case 'status':
        this.floating(a, statusDef(ev.status).name, statusDef(ev.status).tags.includes('debuff') ? C.foe : C.synergy, 11, 1, true)
        break
      case 'cleanse':
        this.burst(a.sprite.x, a.sprite.y - a.chest, BOON, 6, { up: true, speed: 40 })
        break
      case 'gauge':
        this.burst(a.sprite.x, a.sprite.y - a.chest, GAUGE, 6, { speed: 60 })
        break
      // On turns: a Hexed unit's act is lost.
      case 'hexed':
        this.floating(a, 'HEXED', '#c9a6ff', 12)
        this.burst(a.sprite.x, a.sprite.y - a.chest, HEX, 8, { up: true, speed: 50 })
        break
      case 'miss': {
        // A sidestep out of the blow's way.
        const side = (a.uid % 2 ? 1 : -1)
        if (!a.gone) this.animate(a, [{ to: { lean: -8 * side, dx: 12 * side }, ms: 90, ease: 'Quad.Out' }, { to: REST, ms: 220 }])
        this.floating(a, 'miss', '#8e8e9e')
        break
      }
      case 'phase':
        this.floating(a, `PHASE ${ev.phase + 1}`, '#ff6a7a', 16)
        this.shake(260, 0.008)
        this.flashScreen(220, 120, 20, 30)
        break
    }
  }

  // A rule (an 8 step) at work: its name rises over the unit it acts through, the synergies' blue for yours,
  // red for theirs, in a burst of its side's colour. Ambush has no one unit: every gauge on its side flares. Sanctuary, Echo,
  // Dragonfire and Deadeye strike on nearly every cast, so theirs rises at most once a NOISY_MS per side. The first time a
  // side's rule strikes in a battle, its name is also announced over that side's labels (announce).
  rule (ev) {
    const r = RULES[ev.rule]
    if (!r) return
    const mine = ev.side === 'party'
    const colour = mine ? BOON : FOE
    const key = `${ev.side}|${ev.rule}`
    const quiet = NOISY.has(ev.rule) && this.playMs - (this.noisy.get(key) ?? -Infinity) < NOISY_MS
    if (NOISY.has(ev.rule) && !quiet) this.noisy.set(key, this.playMs)
    const who = ev.rule === 'ambush' || quiet ? null : this.actors.get(RULE_ON[ev.rule] === 'actor' ? ev.actor : ev.target)
    if (who) {
      this.floating(who, r.name.toUpperCase(), mine ? '#cfe3ff' : '#ff9aaa', 11, 2)
      this.burst(who.sprite.x, who.sprite.y - who.chest, colour, 12, { up: true, speed: 80 })
    }
    if (ev.rule === 'ambush') {
      for (const a of this.actors.values()) if (a.side === ev.side && !a.gone) this.burst(a.sprite.x, a.sprite.y + BAR_DROP + 5, colour, 6, { up: true, speed: 50 })
    }
    // Bodyguard: a thread of light from the one it shields to the guard who takes the blow.
    const guarded = ev.rule === 'bodyguard' && this.actors.get(ev.target)
    if (who && guarded) {
      const line = this.add.line(0, 0, guarded.sprite.x, guarded.sprite.y - guarded.chest, who.sprite.x, who.sprite.y - who.chest, colour, 0.8)
        .setOrigin(0, 0).setLineWidth(2).setBlendMode(Phaser.BlendModes.ADD).setDepth(9000)
      this.tweens.add({ targets: line, alpha: 0, duration: 420, onComplete: () => line.destroy() })
    }
    if (!this.announced.has(key)) {
      this.announced.add(key)
      this.announce(r, mine)
    }
  }

  // A rule's name for a moment in its side's part of the chrome (args.hud).
  announce (r, mine) {
    this.args.hud?.announce(`${r.step} · ${r.name}`, mine)
  }

  // Rules with no event of their own, seen in the action: Dragonfire (Drake 8) bursts a single-target attack
  // over the foes around its target, Sanctuary (Warden 8) carries an ally ability to every ally: a one-ally
  // one to several, an all-allies one (Dirge, Barkskin) to one beyond its range. Both are named on the actor:
  // the sim lists the targets in acting order, not the struck one first.
  reshaped (ev, a) {
    if (!a || !(ev.targets?.length > 1) || !ev.ability) return
    const def = abilityDef(ev.ability)
    const far = def.shape === 'all_allies' && ev.targets.some((uid) => {
      const t = this.actors.get(uid)
      return t && distance(t.tile, a.tile) > rangeOf(def)
    })
    const rule = def.shape === 'single' ? 'dragonfire' : def.shape === 'ally' || far ? 'sanctuary' : null
    if (rule) this.rule({ type: 'rule', rule, side: a.side, actor: ev.actor })
  }

  // Deadeye (Ranger 8) only fixes a ranged blow's roll (it never misses, and crits), so it has no event of its
  // own: a ranged crit on a foe of a side holding it is named on the striker.
  deadeye (ev, target) {
    const by = this.battle.byUid.get(ev.actor)
    if (!by || by.side === target.side || !ev.ability || abilityDef(ev.ability).melee) return
    if (rulesOf(this.battle, by.side).has('deadeye')) this.rule({ type: 'rule', rule: 'deadeye', side: by.side, actor: ev.actor })
  }

  // Canvas text, drawn at 3× so it stays sharp when the camera zooms.
  text (x, y, str, size, colour, stroke = 0, font = FONT) {
    return this.add.text(x, y, str, { fontFamily: font, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: '#07060b', strokeThickness: stroke })
      .setResolution(3)
  }

  // A blow's flash on the struck: a brief pale wash screened over it (HIT_WASH), so its picture still reads,
  // never a white silhouette (none under reduced motion: the bars and numbers still say it).
  flash (a) {
    if (a.gone || calm) return
    a.sprite.setTint(HIT_WASH).setTintMode(Phaser.TintModes.SCREEN)
    this.time.delayedCall(60 / this.speed, () => a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  // Floating text over a unit; several at once on one unit (a relic, its status, a blow) stack upward, up to
  // FLOAT_ROWS rows, each held FLOAT_HOLD ms (a.rows: when each comes free). A popup takes the lowest rows free
  // now, or waits for the first to come free (a burst bigger than the stack: a fall with three relics, their
  // statuses and RISES), so no popup is drawn over another. `span`: how many rows it takes (a rule's name takes
  // two, over the numbers: the blows its action lands a moment later rise above it, never into it).
  // `side`: a status's name, in its own column to the right of the unit (its own rows, a.sideRows, left-aligned
  // past the widest number), starting lower, so it never lands on the damage numbers rising in the middle.
  floating (a, text, colour, size = 12, span = 1, side = false) {
    const now = this.time.now
    const rows = side ? (a.sideRows ??= new Array(FLOAT_ROWS).fill(0)) : (a.rows ??= new Array(FLOAT_ROWS).fill(0))
    let low = 0
    let at = Infinity
    for (let i = 0; i + span <= FLOAT_ROWS; i++) {
      const free = Math.max(now, ...rows.slice(i, i + span))
      if (free < at) { low = i; at = free }
    }
    for (let i = low; i < low + span; i++) rows[i] = at + FLOAT_HOLD
    const row = low + span - 1
    const wait = at - now
    // Legible at the zoom (a number as a number, a name as a word): the print and its rows grow together.
    const zoom = this.cameras.main.zoom
    const kind = /^[-+−×]?\d/.test(String(text)) ? 'num' : 'word'
    const k = labelScale(size, zoom, kind)
    // It pops in from a little smaller, but never from under the legible size: it reads from its first frame.
    const from = Math.min(1, Math.max(0.6, labelPx(kind) / (size * k * zoom)))
    const draw = () => {
      const t = side
        ? this.text(a.sprite.x + Math.max(22, a.sprite.displayWidth * 0.3), a.sprite.y - a.chest - 2 - SIDE_ROW * k * row, text, size * k, colour, 3).setOrigin(0, 1).setDepth(9500).setScale(from)
        : this.text(a.sprite.x, a.sprite.y - a.chest - 22 - 15 * k * row, text, size * k, colour, 3).setOrigin(0.5, 1).setDepth(9500).setScale(from)
      if (from < 1) this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' })
      this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, delay: 160, duration: 760, ease: 'Quad.Out', onComplete: () => t.destroy() })
    }
    if (wait) this.time.delayedCall(wait, draw)
    else draw()
  }

  // The end. A win or a loss names itself in a banner across the board. A loss is the run's end, so it plays a
  // beat longer as a replay of the facts the end screen keeps (args.death, codex.js deathText): the killer
  // ringed in red where it struck from, the Monarch in gold, the blow struck between them, and who, with what,
  // from where, in the banner, set over their half of the board so the camp stays in view. A battle that ran out
  // its clock says so.
  finish () {
    this.setPaused(false)
    this.ending = true
    this.changed()
    const won = this.battle.winner === 'party'
    sfx.play(won ? 'win' : 'lose')
    // Any orb still in the air (or cut short) is counted before the screen fades.
    this.time.delayedCall(1400, () => { this.purse = this.owed; this.changed() })
    const colour = won ? SOUL : FOE
    // The domain's caption (over the units) gives way to the banner.
    if (this.domLabel?.t.active) this.tweens.add({ targets: this.domLabel.t, alpha: 0, duration: 200 })
    const reason = this.battle.reason
    // The clock ran out: the old battle's ceiling, or on turns its cap.
    const capped = reason === 'tick-ceiling' || reason === 'turn-cap'
    const death = !won ? this.args.death?.() ?? null : null
    // A wave the Sovereign's fall cut short pays for the slain it had (a lost battle pays nothing).
    if (won && this.waves.length > 1) this.waves.forEach((_, k) => this.wavePaid(k))
    const clear = this.battle.floor > TUNING.run.floors ? ' The clear stands.' : ''
    // A boss room (battle.boss, as finishBattle reads it) has no reap: the Sovereign's fall clears the run.
    const [title, line] = won ? (this.battle.boss ? ['THE SOVEREIGN FALLS', `${reason === 'sovereign' ? 'Its court crumbled with it. ' : ''}The run is cleared.`] : ['VICTORY', 'The souls of the slain linger, waiting to be reaped.'])
      : death ? [capped ? 'THE DARK CLOSES IN' : 'THE MONARCH FALLS', `${death.head}. ${death.lines.join(' ')}${clear}`]
        : reason === 'monarch' ? ['THE MONARCH FALLS', `Its retinue crumbles with it. The run is over.${clear}`]
          : capped ? ['THE DARK CLOSES IN', `Still undecided at the last ${this.turns ? 'turn' : 'moment'}: the run is lost.${clear}`]
            : ['YOUR RETINUE FALLS', 'The dead return to the dark.']
    const killer = death && reason === 'monarch' && death.from != null && death.by !== this.monarch ? death.from : null
    const crown = this.actors.get(this.monarch)
    if (killer != null && crown) this.endBeat = { from: posOf(killer), to: { x: crown.home.x, y: crown.home.y }, t0: this.time.now }
    // Over their half of the board (the left) while the blow is replayed on yours, else across the middle.
    const [x, y] = [killer != null ? -HALF_W / 2 : 0, 0]
    const z = this.cameras.main.zoom
    const width = killer != null ? HALF_W : 2 * HALF_W - 80
    const glow = this.add.image(x, y, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 120).setAlpha(0).setDepth(9989)
    // Its line legible at the zoom (labelSize; the title is large already), wrapped to the board, the plate round both.
    const banner = this.text(0, 0, title, labelSize(28, z), won ? C.soul2 : '#ff6a7a', 4, faceFor(28, z)).setOrigin(0.5, 0).setDepth(10000).setAlpha(0)
    const sub = this.text(0, 0, line, labelSize(11, z), '#c8c0d8', 0).setOrigin(0.5, 0).setDepth(10000).setAlpha(0)
      .setWordWrapWidth(width - 40).setAlign('center')
    const ph = banner.height + sub.height + 18
    banner.setPosition(x, y - ph / 2 + 6)
    sub.setPosition(x, banner.y + banner.height + 2)
    const plate = this.add.rectangle(x, y, Math.max(width, banner.width + 60), Math.max(70, ph), 0x07060b, 0.84)
      .setStrokeStyle(1, colour, 0.5).setDepth(9990).setAlpha(0)
    this.tweens.add({ targets: [plate, banner, sub], alpha: 1, duration: 260 })
    this.tweens.add({ targets: glow, alpha: 0.5, duration: 400 })
    this.time.delayedCall(death ? 3600 : 1600, () => {
      this.cameras.main.fadeOut(260, 6, 5, 10)
      this.cameras.main.once('camerafadeoutcomplete', () => this.skip())
    })
  }

  // Every frame of a lost battle's replay beat (finish): the blow drawn from the killer's tile to the Monarch's,
  // and both tiles ringed, pulsing.
  drawEnd (time) {
    const e = this.endBeat
    if (!e) return
    const g = (this.endG ??= this.add.graphics().setDepth(9300))
    const f = Math.min(1, (time - e.t0) / 360)
    const v = calm ? 0.8 : 0.6 + 0.4 * Math.sin((time - e.t0) / 160)
    g.clear()
    const at = (p) => ({ x: p.x, y: p.y - 24 })
    const [a, b] = [at(e.from), at(e.to)]
    const tip = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    g.lineStyle(9, FOE, 0.25).lineBetween(a.x, a.y, tip.x, tip.y)
    g.lineStyle(3, 0xffc0c8, 0.95).lineBetween(a.x, a.y, tip.x, tip.y)
    g.lineStyle(3, FOE, v).strokeEllipse(e.from.x, e.from.y + 4, 70, 22)
    g.lineStyle(3, GOLD, v).strokeEllipse(e.to.x, e.to.y + 4, 74, 24)
  }
}

// ── timeline player ──────────────────────────────────────────────────────────────────────────────

// Sim events → tweens, poses and FX. The player only reads events; it never computes a result.
// Events are appended as the battle steps (always in tick order) and played when the playhead,
// which the scene drives with the same clock as the sim, reaches their tick. On turns (`beats`) there is no clock:
// events come an order at a time, stamped with a beat, and each beat plays once the one before has had its time
// (spanOf: an action its animation, a move its path), never before now.

const ESSENTIAL = new Set(['anim', 'popup', 'tween'])

class TimelinePlayer {
  constructor (scene, { template, actorOf, tickMs = 50, beats = false, onEvent = null }) {
    this.scene = scene
    this.template = template
    this.actorOf = actorOf
    this.tickMs = tickMs
    this.beats = beats
    this.onEvent = onEvent
    // On turns: when the last beat began (tail), how long it takes (span), and its index (last).
    this.tail = 0
    this.span = 0
    this.last = null
    this.playhead = 0
    this.speed = 1
    this.queue = []       // beats: { at, action, results }
    this.cursor = 0
    this.scheduled = []   // { at, run }
    this.warned = new Set()
    this.seq = new WeakMap() // event → its place in the stream, so a late-shown result never undoes a newer one
    this.count = 0
  }

  // An `action` owns the events that follow it in the same batch and tick (its damage, statuses…), or on turns the
  // same beat. One stepBattle call is one tick, and one order's events end its beats, so a beat never spans two
  // enqueue calls.
  enqueue (events) {
    let beat = null
    const key = (ev) => (this.beats ? ev.beat : ev.t)
    for (const ev of events) {
      this.seq.set(ev, this.count++)
      const at = this.beats ? this.slot(ev) : ev.t * this.tickMs
      if (ev.type === 'action') {
        beat = { at, action: ev, results: [] }
        this.queue.push(beat)
      } else if (beat && key(ev) === key(beat.action)) {
        beat.results.push(ev)
      } else {
        this.queue.push({ at, action: null, results: [ev] })
        beat = null
      }
    }
  }

  // On turns: when `ev` plays (its beat's start), each beat after the last has had its span, and none before now.
  slot (ev) {
    if (ev.beat !== this.last) {
      this.tail = Math.max(this.tail + this.span, this.playhead)
      this.span = 0
      this.last = ev.beat
    }
    this.span = Math.max(this.span, spanOf(ev, this.template))
    return this.tail
  }

  // On turns, the playhead skips ahead to the last beat's end: every beat queued plays now (Skip).
  get end () {
    return this.tail + this.span
  }

  setSpeed (n) {
    this.speed = n
    this.scene.tweens.timeScale = n
  }

  // Every beat played (on turns, the last one's time run too).
  get finished () {
    return this.cursor >= this.queue.length && this.scheduled.length === 0 && (!this.beats || this.playhead >= this.tail + this.span)
  }

  update (playhead) {
    this.playhead = playhead
    while (this.cursor < this.queue.length && this.queue[this.cursor].at <= playhead) {
      this.play(this.queue[this.cursor++])
    }
    if (!this.scheduled.length) return
    const due = this.scheduled.filter((s) => s.at <= playhead)
    if (!due.length) return
    this.scheduled = this.scheduled.filter((s) => s.at > playhead)
    for (const s of due) s.run()
  }

  play (beat) {
    const tpl = beat.action?.anim ? this.template(beat.action.anim) : null
    if (beat.action) this.onEvent?.(beat.action, true)
    // What an action did shows when its blow lands (its template's popup), not as the attacker winds up.
    // Steps between the two happen at once.
    const impact = tpl?.steps.find((s) => s.op === 'popup')?.t ?? 0
    beat.results.forEach((ev, i) => {
      const run = () => this.onEvent?.(ev, !!beat.action, this.seq.get(ev))
      // A move, a shadow rising (see arise) and a unit entering (see enter) play at once: the newcomer may
      // act within a few ticks. An Echo's second pass lands a beat after the first (echoed).
      const at = impact + echoed(beat, i)
      if (at && ev.type !== 'move' && ev.type !== 'arise' && ev.type !== 'enter') this.scheduled.push({ at: this.playhead + at, run })
      else run()
    })
    if (!beat.action) return
    const actor = this.actorOf(beat.action.actor)
    if (!tpl || !actor) return
    const hit = beat.results.find((e) => e.type === 'damage' || e.type === 'heal')
    const primary = this.actorOf(hit?.target ?? beat.action.targets?.[0])
    const refs = { actor, primary, beat }
    for (const step of tpl.steps) {
      if (this.speed >= 4 && !ESSENTIAL.has(step.op)) continue
      const run = () => this.runStep(step, refs)
      if (step.t === 0) run()
      else this.scheduled.push({ at: this.playhead + step.t, run })
    }
  }

  runStep (step, refs) {
    const fn = STEPS[step.op]
    if (!fn) {
      if (!this.warned.has(step.op)) {
        this.warned.add(step.op)
        console.warn(`anim step op "${step.op}" is unknown, skipping it`)
      }
      return
    }
    try {
      fn(this, step, refs)
    } catch (e) {
      console.warn(`anim step "${step.op}" failed:`, e.message)
    }
  }

  where (name, { actor, primary }) {
    switch (name) {
      case 'actor': return { x: actor.sprite.x, y: actor.sprite.y }
      case 'target': return primary ? { x: primary.sprite.x, y: primary.sprite.y } : { ...actor.home }
      case 'targetAdj': {
        // Stop short of the target along the line between the two homes.
        if (!primary || primary === actor) return { ...actor.home }
        const dx = primary.home.x - actor.home.x
        const dy = primary.home.y - actor.home.y
        const len = Math.hypot(dx, dy) || 1
        const stand = Math.min(30, len * 0.35)
        return { x: primary.sprite.x - (dx / len) * stand, y: primary.sprite.y - (dy / len) * stand }
      }
      default: return { ...actor.home }
    }
  }
}

// On turns, how long a beat takes once begun, by its longest event (playhead ms, so a faster speed shortens it): an
// action its animation's (content.js ANIMS dur), a move a tile of its path a STEP_MS, the rest what their pictures
// need to read (a wave's banner, a shadow rising, the foes' turn's word).
function spanOf (ev, template) {
  switch (ev.type) {
    case 'action': return ev.anim ? template(ev.anim).dur ?? 600 : 300
    case 'move': return (ev.path?.length ?? 1) * STEP_MS + 60
    case 'undo': return STEP_MS + 60
    case 'stage': return ev.stage === 'foes' ? 650 : 120
    case 'turn': return 300
    case 'wave': return 900
    case 'enter': return 600
    case 'arise': return 1100
    case 'fuse': return 1000
    case 'death': return 450
    case 'hexed': return 500
    default: return 100
  }
}

// How much later than the rest of its beat result `i` shows: ECHO_MS for an Echo's second pass, the results
// after its `rule` event.
function echoed (beat, i) {
  const at = beat.results.findIndex((e) => e.type === 'rule' && e.rule === 'echo')
  return at >= 0 && i > at ? ECHO_MS : 0
}

// An ability's colour, for its bolts, beams and hit sparks.
const tint = (ability) => parseInt((ability ? abilityDef(ability).tint : '#d8d4cc').slice(1), 16)

const STEPS = {
  anim (p, step, refs) {
    const [who, other] = step.who === 'target' ? [refs.primary, refs.actor] : [refs.actor, refs.primary]
    if (who) p.scene.strike(who, step.key, other !== who ? other : null)
  },

  tween (p, step, refs) {
    const who = step.who === 'target' ? refs.primary : refs.actor
    if (!who || who.gone) return
    const to = p.where(step.to, refs)
    p.scene.tweens.add({ targets: who.sprite, x: to.x, y: to.y, duration: step.dur ?? 150, ease: step.ease ?? 'Linear' })
  },

  // A ring of light where the blow lands (the sparks come with the damage event).
  fx (p, step, refs) {
    const at = p.where(step.at ?? 'target', refs)
    const lift = (step.at === 'actor' ? refs.actor : refs.primary ?? refs.actor).chest
    const ring = p.scene.add.image(at.x, at.y - lift, 'glow').setTint(tint(refs.beat.action.ability))
      .setBlendMode(Phaser.BlendModes.ADD).setScale(0.3).setAlpha(0.9).setDepth(9200)
    p.scene.tweens.add({ targets: ring, scale: 1.3, alpha: 0, duration: 300, ease: 'Cubic.Out', onComplete: () => ring.destroy() })
  },

  // A crescent swung across the target, edge-on to the blow.
  slash (p, step, refs) {
    const { actor, primary } = refs
    if (!primary || primary === actor) return
    const angle = Math.atan2(primary.sprite.y - actor.sprite.y, primary.sprite.x - actor.sprite.x)
    const flip = refs.beat.action.t % 2 ? 1 : -1
    const arc = p.scene.add.image(primary.sprite.x, primary.sprite.y - primary.chest, 'slash')
      .setTint(tint(refs.beat.action.ability)).setBlendMode(Phaser.BlendModes.ADD).setDepth(9250)
      .setRotation(angle).setScale(0.35, 0.35 * flip).setAlpha(0)
    p.scene.tweens.add({ targets: arc, scaleX: 0.75, scaleY: 0.75 * flip, alpha: { from: 1, to: 0 }, rotation: angle + 0.6 * flip, duration: 240, ease: 'Cubic.Out', onComplete: () => arc.destroy() })
  },

  projectile (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const colour = tint(refs.beat.action.ability)
    const [up, down] = [refs.actor.chest, (refs.primary ?? refs.actor).chest]
    const bolt = p.scene.add.image(from.x, from.y - up, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setScale(0.35).setDepth(9000)
    const core = p.scene.add.image(from.x, from.y - up, 'spark').setScale(0.6).setDepth(9001)
    p.scene.tweens.add({
      targets: [bolt, core], x: to.x, y: to.y - down, duration: step.dur ?? 180, ease: 'Quad.In',
      onComplete: () => { bolt.destroy(); core.destroy() }
    })
  },

  beam (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const colour = tint(refs.beat.action.ability)
    const [up, down] = [refs.actor.chest, (refs.primary ?? refs.actor).chest]
    const glow = p.scene.add.line(0, 0, from.x, from.y - up, to.x, to.y - down, colour, 0.35)
      .setOrigin(0, 0).setLineWidth(6).setBlendMode(Phaser.BlendModes.ADD).setDepth(9000)
    const line = p.scene.add.line(0, 0, from.x, from.y - up, to.x, to.y - down, 0xffffff, 0.9)
      .setOrigin(0, 0).setLineWidth(1.5).setDepth(9001)
    p.scene.tweens.add({ targets: [glow, line], alpha: 0, duration: step.dur ?? 220, onComplete: () => { glow.destroy(); line.destroy() } })
  },

  // A template's shake is a routine blow's: calm by default, it shakes only when the template says `always`.
  // The heavy blows (a crit, the Monarch struck) shake through their events instead (BattleScene.shake).
  shake (p, step) {
    if (step.always) p.scene.shake(step.dur ?? 120, (step.mag ?? 4) / 900)
  },

  // The numbers on screen are read off the events the sim already computed.
  // An Echo's second pass pops up a beat later (echoed).
  popup (p, step, refs) {
    refs.beat.results.forEach((ev, i) => {
      if (ev.type !== 'damage' && ev.type !== 'heal') return
      const value = ev.type === 'heal' ? ev.heal : ev.damage
      const target = p.actorOf(ev.target)
      if (!value || !target) return
      const run = () => p.scene.floating(target, `${ev.type === 'heal' ? '+' : ''}${value}${ev.isCrit ? '!' : ''}`,
        ev.type === 'heal' ? '#7be0a0' : ev.isCrit ? '#ffd28a' : '#f4ece0', ev.isCrit ? 18 : 13)
      const late = echoed(refs.beat, i)
      if (late) p.scheduled.push({ at: p.playhead + late, run })
      else run()
    })
  }
}

// The board's measures and colours, for the prep board (board.js), which draws the very board a battle plays on.
export { RES, FEET, SCALE, TILE_W, TILE_H, FOOT, HALF_W, HALF_H, BOX, posOf, posAt, BIG, HOVER, BOB, tileUnder, cellsBox, facesLeft, WALLS, WALL_FOOT, WALL_SCALE, BAR, BAR_DROP, BREATH, PARTY, FOE, SOUL, CROWN, DOMAIN, PLAN, NEUTRAL, FONT, hex }
