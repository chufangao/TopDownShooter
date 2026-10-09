// The prep board: the battle's own board, drawn in Phaser under the Field tab (ui.js fieldEditor), so the army
// is arranged on the very picture the battle plays on. It draws a picture of plain data that the editor builds
// on every render (ui.js: the picture), with the plan laid over it (DESIGN §4): the roads as arrows, the domain,
// the selected piece's ring, every line with its signal's marker, the timing marks, and each synergy's glow. It
// tells the editor which tile or marker lies under the pointer, lifts a piece while it is dragged, sketches a
// line while one is drawn, and at Begin fades into the battle with everyone where they stood. It decides
// nothing: every rule, every tooltip and every action stays in ui.js.
import Phaser from './vendor/phaser.js'
import { unitDef } from './content.js'
import { LANES, DEPTH, TILES, ROWS, CAMP_ROWS, tileX, tileY, tileAt as tileOf } from './sim/unit.js'
import {
  RES, FEET, SCALE, ROW_PX, SPREAD, EDGE, rowY, WALLS, WALL_FOOT, WALL_SCALE, BAR, BAR_DROP, BREATH,
  PARTY, FOE, SOUL, CROWN, DOMAIN, PLAN, NEUTRAL, C, FONT, hex, growthMarks, palette, reducedMotion, legible,
  domainLabel, placeOutside, overlap, faceFor, HORDE, syncHorde, placeHorde
} from './engine.js'
import { sfx } from './sfx.js'

const BAND = LANES * SPREAD + 90 // the dais under each side, as the battle draws it
const HIT_UP = 20                // a tile takes the pointer over its unit's body: centred this far above the feet
const MARK_X = 32                // the marks beside a unit's feet stand this far either side of it (a lane is SPREAD)
const TOP = 82                   // above their back row's tiles: its heads, and the label over them
const ROSE = '#f08a98'
const GROUND = 6                 // a tile's ground lies this far under its centre: lines and arrows run on it
// A drag by touch: the piece is drawn LIFT CSS px above the finger (feet first), so the finger hides neither it
// nor the tile it would land on, and the drop goes by its feet. Where a tile stands under ZOOM_UNDER CSS px tall
// (a phone's whole board), the camera eases in for the drag and back out after (dragView): on the camp for a
// piece, on the finger for a line, panning on as the finger nears the stage's edge (EDGE_PAN of its size).
export const DRAG = { lift: 48, zoomUnder: 40, ms: 200, zoom: 1.8, pan: 0.16, panPx: 9 }
const TOUCH_SLOP = 8
// A marker takes a press within this many CSS px of its centre, however small the board.
const MARKER_HIT = 22
// The pointer of the last press (touch or not), read when a drag lifts.
let pointerType = 'mouse'
const posFor = (tile) => ({ x: (tileX(tile) - (LANES - 1) / 2) * SPREAD, y: rowY(tileY(tile)) })
const groundOf = (tile) => { const p = posFor(tile); return { x: p.x, y: p.y + GROUND } }

let engine = null
let scene = null    // the PrepScene while it runs
let starting = false
// What to show: { stage (the editor's board element, which the camera keeps the board inside), avoid (the
// elements laid over the stage, kept clear), picture }.
let want = null
// An editor draws before its screen is on the page: the last picture asked of each stage not yet on it.
const pending = new WeakMap()

// Starts the scene when a shown stage wants it and it is not running (the first time, and after a handoff).
function boot () {
  if (scene || starting || !engine || !want?.stage.isConnected) return
  starting = true
  engine.ready.then(() => engine.game.scene.start('Prep'))
}

export const board = {
  attach (e) {
    engine = e
    e.game.scene.add('Prep', PrepScene, false)
    window.addEventListener('pointerdown', (ev) => { pointerType = ev.pointerType }, true)
  },

  // Draws `picture` inside `stage`; starts the scene the first time, and wakes it when it slept (see update).
  // A stage not on the page is drawn once it is, if that is still its last picture (an editor builds before
  // its screen goes up); one that never arrives, or left (an old screen's), is ignored.
  show (stage, picture, avoid = []) {
    const w = { stage, picture, avoid: avoid.filter(Boolean) }
    if (!stage.isConnected) {
      pending.set(stage, w)
      queueMicrotask(() => { if (pending.get(stage) === w && stage.isConnected) board.show(stage, picture, avoid) })
      return
    }
    pending.delete(stage)
    // Another editor's drag never carries over to this one.
    if (want?.stage !== stage) scene?.dropped()
    want = w
    if (!scene) return boot()
    if (scene.leaving) return
    if (scene.sys.isSleeping()) scene.sys.wake()
    scene.draw(picture)
  },

  // The board tile under a viewport point, or null.
  tileAt: (x, y) => scene?.tileAt(x, y) ?? null,
  // The uid of the line whose signal's marker lies under a viewport point, or null.
  markerAt: (x, y) => scene?.markerAt(x, y) ?? null,
  // A tile's rect in viewport pixels, for its tooltip; a marker's, by its line's uid.
  rectOf: (tile) => scene?.rectOf(tile) ?? null,
  markerRect: (uid) => scene?.markerRect(uid) ?? null,
  hover (tile) { if (scene) scene.hovered = tile },
  // Moving: lift a board piece by its key (or a soul from the bench, { id }), follow the pointer with what a
  // drop there would do (`preview`, see the editor's dragPreview), and put it down (the editor's next picture
  // places it).
  lift (what, x, y) { scene?.lift(what, x, y) },
  // `off`: the pointer is off the board (over the bench, the panel): the lifted piece hides (the editor shows it).
  follow (x, y, preview, off = false) { scene?.follow(x, y, preview, off) },
  drop () { scene?.dropped() },
  // Drawing a line: begin at a viewport point (by touch on a small board the camera eases in on it, and pans on
  // near the stage's edge, calling onPan(x, y) with the finger's point so the line can follow), sketch it as it
  // grows ({ from, tiles, ok }), and end.
  trace (x, y, onPan) { scene?.trace(x, y, onPan) },
  sketch (line, x, y) { scene?.sketch(line, x, y) },
  // A purchase or a change to one unit (by key): a pop of light on it.
  pop (key) { scene?.pop(key) },
  // The board's zoom: viewport pixels to a world pixel (a unit's picture is about 90 tall).
  zoom: () => scene?.view?.z ?? 1,
  // The keyboard's tile (a frame of its own while the board has focus), or null.
  focus (tile) { if (scene) scene.focused = tile },

  // Begin: the prep picture stays up until the battle's is built under it, then glides to the battle's view and
  // fades into it, so nobody seems to move. → a function to call with the battle scene, or null (no board).
  leave () {
    const sc = scene
    if (!sc || sc.leaving || !want?.stage.isConnected || sc.sys.isSleeping()) return null
    sc.leaving = true
    // A battle that never comes (its start failed) must not leave the board hanging.
    const late = setTimeout(() => sc.abort(), 6000)
    return (battle) => { clearTimeout(late); sc.handoff(battle) }
  }
}

class PrepScene extends Phaser.Scene {
  constructor () { super('Prep') }

  // The zoom the board's print is kept legible at: the fitted view's, not a drag's eased-in one (dragView).
  get labelZ () { return this.fitted?.z ?? this.view?.z }

  create () {
    palette()
    scene = this
    starting = false
    this.actors = new Map() // key → { sprite, shadow, scale, size, chest, tile, u, parts, growth, pop, rise, lifted }
    this.layer = []         // the picture's texts, made anew on every draw
    this.picture = null
    this.view = null        // the camera's mapping (see fit)
    this.fitted = null      // the board's own view, the one fit chose; a drag by touch may ease in from it (dragView)
    this.camAnim = null     // { from, to, t0, ms, back }: the camera easing between the two
    this.fitKey = ''
    this.hovered = null
    this.focused = null
    this.drag = null
    this.swapGhost = null
    this.markerHits = []
    this.leaving = false
    this.into = null
    this.beat = { v: 0 }
    this.tweens.add({ targets: this.beat, v: 1, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    this.ground()
    this.wallArt = { key: null, art: [] }
    this.tileG = this.add.graphics().setDepth(-400)
    this.roadG = this.add.graphics().setDepth(-398)
    this.domG = this.add.graphics().setDepth(-395)
    // While a piece is dragged: the domain lit (pulsing, see update) and the ground outside it dimmed.
    this.glowG = this.add.graphics().setDepth(-394)
    this.dimG = this.add.graphics().setDepth(-393)
    this.ringG = this.add.graphics().setDepth(-392)
    this.lineG = this.add.graphics().setDepth(-386)
    this.liveG = this.add.graphics().setDepth(-384) // redrawn every frame: hover, the drop target
    this.markG = this.add.graphics().setDepth(7400) // the signals' markers and the timing marks' plates
    this.sketchG = this.add.graphics().setDepth(9600) // a line being drawn, over everything
    this.sketchText = null
    this.sparks = this.add.particles(0, 0, 'spark', {
      emitting: false, lifespan: 600, speed: { min: 30, max: 90 }, angle: { min: 230, max: 310 }, gravityY: -40,
      scale: { start: 0.6, end: 0 }, alpha: { start: 1, end: 0 }, tint: [SOUL, 0xffe9a8], blendMode: 'ADD'
    }).setDepth(9300)
    // Stopped after a handoff: an editor already back on screen (a battle skipped mid-glide) starts it again.
    this.events.once('shutdown', () => {
      if (scene === this) scene = null
      setTimeout(boot)
    })
    // Opaque, so the battle being built under it at Begin never shows through.
    this.cameras.main.setBackgroundColor('#08070d').fadeIn(220, 6, 5, 10)
    if (want) this.draw(want.picture)
  }

  // The floor, the vignette, the two daises and the seam between them, and the motes: as the battle's.
  ground () {
    this.add.tileSprite(0, 0, 4200, 3200, 'floor').setTileScale(0.6).setAlpha(0.62).setDepth(-1000)
    const [vw, vh] = [BAND + 1100, 2 * EDGE + 1000]
    this.add.image(0, 0, 'vignette').setDisplaySize(vw, vh).setDepth(-999)
    for (const [x, y, w, h] of [[0, -vh / 2 - 1500, 9000, 3000], [0, vh / 2 + 1500, 9000, 3000], [-vw / 2 - 2000, 0, 4000, vh], [vw / 2 + 2000, 0, 4000, vh]]) {
      this.add.rectangle(x, y, w + 2, h + 2, 0x06050a, 0.96).setDepth(-999)
    }
    const g = this.add.graphics().setDepth(-401)
    for (const [y0, y1, colour] of [[0, CAMP_ROWS - 1, PARTY], [DEPTH - ROWS, DEPTH - 1, FOE]]) {
      const top = rowY(y1) - 40
      const h = rowY(y0) - rowY(y1) + 80
      g.fillStyle(colour, 0.045).fillRoundedRect(-BAND / 2, top, BAND, h, 18)
      g.lineStyle(1, colour, 0.22).strokeRoundedRect(-BAND / 2, top, BAND, h, 18)
    }
    this.add.image(0, rowY((CAMP_ROWS + DEPTH - ROWS - 1) / 2), 'glow').setDisplaySize(BAND + 260, 26).setTint(NEUTRAL).setAlpha(0.35)
      .setBlendMode(Phaser.BlendModes.ADD).setDepth(-390)
    this.add.particles(0, 0, 'glow', {
      x: { min: -BAND / 2 - 60, max: BAND / 2 + 60 }, y: { min: -EDGE - 68, max: EDGE + 68 }, lifespan: 7000,
      speedY: { min: -14, max: -4 }, speedX: { min: -6, max: 6 }, scale: { start: 0.14, end: 0 }, alpha: { start: 0.45, end: 0 },
      tint: [SOUL, NEUTRAL], frequency: 160, blendMode: 'ADD'
    }).setDepth(-300)
  }

  text (x, y, str, size, colour, stroke = 0, font = FONT) {
    const t = this.add.text(x, y, str, { fontFamily: font, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: '#07060b', strokeThickness: stroke })
      .setResolution(3)
    this.layer.push(t)
    return t
  }

  // ── the picture ──────────────────────────────────────────────────────────────────────────────

  // p: { walls, facing, units, domain: { centre, r }, roads (each tile's arrow, field().arrow), ring ({ tile, r,
  // foe } or null), lines ([{ key, uid, from, tiles, tag, signal, sel, dim, wing }]: a `wing` line is a Banner's
  // follower's, its Banner's shifted, drawn with no marker), marks ([{ tile, text, sel }]), drop (tiles a drag
  // may land on), selTile, selKey }. A unit: { key, id, tile, side, hp, maxHp, lvl, tracks, count, monarch,
  // fallen, sel, glow (colours), lit, ghost, banner (it leads a wing), follows (it follows a Banner) }.
  draw (p) {
    const old = this.picture
    this.picture = p
    for (const o of this.layer) o.destroy()
    this.layer = []
    this.drawWalls(p.walls)
    this.drawTiles(p)
    this.drawRoads(this.drag?.preview?.roads ?? p.roads)
    this.drawDomain(this.drag?.preview?.centre ?? p.domain?.centre ?? null)
    this.drawRing(p.ring)
    this.drawLines(p)
    this.drawLabels(p)
    // The units, kept by key: one that changed tile walks there (a place), one that grew pops.
    const seen = new Set()
    let moved = false
    for (const u of p.units) {
      seen.add(u.key)
      let a = this.actors.get(u.key)
      if (a && a.u.id !== u.id) { this.dropActor(a, false); a = null }
      if (!a) a = this.addActor(u, !!old)
      else if (a.tile !== u.tile) {
        moved ||= u.key[0] === 's' && !a.lifted
        this.tweens.killTweensOf(a.sprite)
        const to = posFor(u.tile)
        this.tweens.add({ targets: a.sprite, x: to.x, y: to.y, duration: 240, ease: 'Back.Out' })
      }
      const was = a.u
      a.tile = u.tile
      a.u = u
      this.dress(a)
      if (old && was !== u && grew(was, u)) this.pop(u.key)
    }
    for (const [key, a] of this.actors) if (!seen.has(key)) this.dropActor(a, true)
    if (old && moved) sfx.play('place')
    if (old && p.selKey && p.selKey !== old.selKey) sfx.play('select')
    this.layoutMarks()
    if (this.drag?.piece) this.follow(null, null, this.drag.preview)
    this.fitKey = ''
  }

  drawWalls (walls) {
    const key = walls.join()
    if (key === this.wallArt.key) return
    for (const o of this.wallArt.art) o.destroy()
    this.wallArt = {
      key,
      art: walls.map((tile) => {
        const p = posFor(tile)
        return this.add.image(p.x, p.y + 8, WALLS[(tile * 7 + (tile >> 3)) % WALLS.length]).setOrigin(0.5, WALL_FOOT)
          .setScale(WALL_SCALE / RES).setFlipX(tile % 2 === 1).setDepth(p.y)
      })
    }
  }

  // A rune under every open tile, in its side's colour; brighter where someone stands, where a dragged piece
  // may go (`drop`), and under a selected tile.
  drawTiles (p) {
    const g = this.tileG.clear()
    const walls = new Set(p.walls)
    const taken = new Set(p.units.map((u) => u.tile))
    const drop = new Set(p.drop)
    for (let tile = 0; tile < TILES; tile++) {
      if (walls.has(tile)) continue
      const { x, y } = posFor(tile)
      const ty = tileY(tile)
      const colour = ty < CAMP_ROWS ? PARTY : ty >= DEPTH - ROWS ? FOE : NEUTRAL
      g.lineStyle(1.2, colour, taken.has(tile) ? 0.45 : 0.14).strokeEllipse(x, y + GROUND, 50, 15)
      if (drop.has(tile)) {
        g.fillStyle(SOUL, 0.08).fillEllipse(x, y + GROUND, 56, 18)
        g.lineStyle(1.5, SOUL, 0.55).strokeEllipse(x, y + GROUND, 56, 18)
      }
      if (tile === p.selTile) {
        g.fillStyle(SOUL, 0.14).fillEllipse(x, y + GROUND, 62, 20)
        g.lineStyle(2.5, SOUL, 0.95).strokeEllipse(x, y + GROUND, 62, 20)
      }
    }
  }

  // The roads (DESIGN §2.6): on every tile a road reaches, a small chevron toward the next tile on it, in the
  // foes' red, faint: terrain, under everything. `arrow`: each tile's next tile (−1: none, the Monarch's own).
  drawRoads (arrow) {
    const g = this.roadG.clear()
    if (!arrow) return
    for (let t = 0; t < TILES; t++) {
      const to = arrow[t]
      if (to < 0) continue
      const a = groundOf(t)
      const b = groundOf(to)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len]
      const [cx, cy] = [a.x + ux * 12, a.y + uy * 12]
      g.lineStyle(3, FOE, 0.42)
      g.lineBetween(cx + ux * 9, cy + uy * 9, cx - ux * 5 - uy * 9, cy - uy * 5 + ux * 9)
      g.lineBetween(cx + ux * 9, cy + uy * 9, cx - ux * 5 + uy * 9, cy - uy * 5 - ux * 9)
    }
  }

  // The square a ring covers around a tile, clipped to the board, as a world box.
  boxOf (tile, r, pad = 4) {
    const [mx, my] = [tileX(tile), tileY(tile)]
    const [x0, x1] = [Math.max(0, mx - r), Math.min(LANES - 1, mx + r)]
    const [y0, y1] = [Math.max(0, my - r), Math.min(DEPTH - 1, my + r)]
    return {
      l: (x0 - (LANES - 1) / 2) * SPREAD - SPREAD / 2 + pad,
      r: (x1 - (LANES - 1) / 2) * SPREAD + SPREAD / 2 - pad,
      t: rowY(y1) - ROW_PX / 2 + pad / 2,
      b: rowY(y0) + ROW_PX / 2 - pad / 2
    }
  }

  // The Monarch's domain around `centre`. While a piece is dragged the domain lights up and the ground outside
  // it dims; a dragged Monarch carries it.
  drawDomain (centre) {
    const p = this.picture
    const g = this.domG.clear()
    const glow = this.glowG.clear()
    const dim = this.dimG.clear()
    this.domLabel?.destroy()
    this.domLabel = null
    const d = p.domain
    if (!d || centre == null) return
    const box = this.boxOf(centre, d.r)
    const [w, h] = [box.r - box.l, box.b - box.t]
    g.fillStyle(DOMAIN, 0.045).fillRoundedRect(box.l, box.t, w, h, 12)
    g.lineStyle(1.5, DOMAIN, 0.45).strokeRoundedRect(box.l, box.t, w, h, 12)
    if (this.drag?.piece) {
      glow.fillStyle(DOMAIN, 0.17).fillRoundedRect(box.l, box.t, w, h, 12)
      glow.lineStyle(3, DOMAIN, 0.95).strokeRoundedRect(box.l, box.t, w, h, 12)
      const far = 5000
      dim.fillStyle(0x05040a, 0.45)
        .fillRect(-far, -far, 2 * far, box.t + far).fillRect(-far, box.b, 2 * far, far)
        .fillRect(-far, box.t, box.l + far, h).fillRect(box.r, box.t, far, h)
    }
    // Just outside the box, as the battle's (engine.js domainLabel), over the units, at the corner that covers
    // fewest of their bodies and marks (placeDomain).
    this.domLabel = domainLabel(this, d.r).setDepth(7900)
    this.domBox = box
    legible(this.domLabel, this.labelZ, 'word')
    this.placeDomain()
  }

  // The selected piece's ring (DESIGN §2.3): the square it fights within, outlined in your lines' blue, or the
  // foes' red for a foe of a kind already met.
  drawRing (ring) {
    const g = this.ringG.clear()
    if (!ring || !(ring.r > 0)) return
    const box = this.boxOf(ring.tile, ring.r, 8)
    const colour = ring.foe ? FOE : PLAN
    g.fillStyle(colour, 0.07).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 10)
    g.lineStyle(2.5, colour, 0.85).strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 10)
  }

  // Every line (DESIGN §2.4): a path in your blue from its piece's tile along its tiles, an arrowhead at its end,
  // the selected piece's bold and the rest faint; on its first step the marker of the signal it waits for (a
  // press there steps it through them); and the timing marks, where each piece will stand at 5, 10 and 15 s.
  drawLines (p) {
    const g = this.lineG.clear()
    const m = this.markG.clear()
    this.markerHits = []
    const z = this.labelZ
    const lines = (p.lines ?? []).slice().sort((a, b) => !!a.sel - !!b.sel)
    for (const l of lines) {
      const pts = [l.from, ...l.tiles].map(groundOf)
      const [w, alpha] = l.sel ? [5, 0.95] : [3, l.dim ? 0.3 : 0.6]
      // A follower's march, its Banner's line shifted: dashed, lighter, the wing's.
      if (l.wing) {
        for (const [c, k, wd] of [[0x07060b, 0.5, w + 3], [0xb4d6ff, 1, w]]) {
          g.lineStyle(wd, c, Math.min(1, alpha * 1.2) * k)
          for (let i = 1; i < pts.length; i++) dashed(g, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, 10, 6)
        }
        arrowHead(g, pts.at(-2), pts.at(-1), 0xb4d6ff, Math.min(1, alpha * 1.2), l.sel ? 14 : 11)
        continue
      }
      g.lineStyle(w + 4, 0x07060b, alpha * 0.5).strokePoints(pts, false)
      g.lineStyle(w, PLAN, alpha).strokePoints(pts, false)
      for (const q of pts.slice(1, -1)) g.fillStyle(PLAN, alpha).fillCircle(q.x, q.y, w * 0.7)
      arrowHead(g, pts.at(-2), pts.at(-1), PLAN, alpha, l.sel ? 15 : 11)
    }
    // The markers, over the units: a disc on the line's first step, set off to its right (a picture stands taller
    // than its row, so straight up the line it would cover its own piece's face), with its tag.
    for (const l of lines) {
      if (l.wing) continue
      const a = groundOf(l.from)
      const b = groundOf(l.tiles[0])
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const [ux, uy] = [(b.x - a.x) / len, (b.y - a.y) / len]
      const c = { x: a.x + (b.x - a.x) * 0.7 - uy * 36, y: a.y + (b.y - a.y) * 0.7 + ux * 36 }
      const t = legible(this.text(c.x, c.y, l.tag, l.signal ? 11 : 10, l.signal ? '#ffffff' : '#bcd8ff', 0).setOrigin(0.5).setDepth(7410).setData('size', 11), z, 'num')
      const r = Math.max(14, t.displayWidth / 2 + 7, t.displayHeight / 2 + 5)
      const alpha = l.sel ? 1 : l.dim ? 0.55 : 0.85
      m.fillStyle(l.signal ? PLAN : 0x0c1a30, alpha).fillCircle(c.x, c.y, r)
      m.lineStyle(l.sel ? 3 : 2, l.signal ? 0xffffff : PLAN, alpha).strokeCircle(c.x, c.y, r)
      t.setAlpha(alpha)
      this.markerHits.push({ uid: l.uid, x: c.x, y: c.y, r })
    }
    // The timing marks: a small plate on the tile a piece will stand on, its moments (5s, 10·15s) in print, the
    // selected piece's bright; several on one tile stack down it.
    const at = new Map()
    for (const k of p.marks ?? []) {
      const q = groundOf(k.tile)
      const n = at.get(k.tile) ?? 0
      at.set(k.tile, n + 1)
      const t = legible(this.text(q.x + 14, q.y + 10, k.text, 10, k.sel ? '#ffffff' : '#a9c6ee', 0).setOrigin(0, 0.5).setDepth(7405).setData('size', 10), z, 'num')
      t.setY(q.y + 10 + n * (t.displayHeight + 3))
      const [w, hgt] = [t.displayWidth + 8, t.displayHeight + 2]
      m.fillStyle(k.sel ? 0x1a3a66 : 0x0c1626, k.sel ? 0.95 : 0.8).fillRoundedRect(t.x - 4, t.y - hgt / 2, w, hgt, hgt / 2)
      m.lineStyle(1.2, PLAN, k.sel ? 0.95 : 0.5).strokeRoundedRect(t.x - 4, t.y - hgt / 2, w, hgt, hgt / 2)
      t.setAlpha(k.sel ? 1 : 0.85)
    }
  }

  drawLabels (p) {
    const x = -LANES / 2 * SPREAD + 4
    const y = rowY(DEPTH - 1) - 88
    legible(this.text(x, y, p.facing ? 'THEIR FORMATION' : 'THEIR GROUND', 14, p.facing ? ROSE : '#b0808e', 3, faceFor(14, this.labelZ)).setOrigin(0, 1).setDepth(-300), this.labelZ)
  }

  // ── units ────────────────────────────────────────────────────────────────────────────────────

  addActor (u, appear) {
    const art = unitDef(u.id).art
    const home = posFor(u.tile)
    const sprite = this.add.image(home.x, home.y, `unit:${art}:alive`).setOrigin(0.5, FEET).setFlipX(u.side === 'foe')
    const size = sprite.width / RES / 96
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size, 13 * size, 0x000000, 0.5)
    const a = { key: u.key, sprite, shadow, scale: SCALE / RES, size, chest: 30 * size, tile: u.tile, u, parts: [], growth: null, horde: [], pop: { v: 0 }, rise: { v: appear ? 0 : 1 }, seed: Math.random() * 6 }
    if (appear && reducedMotion()) a.rise.v = 1
    else if (appear) this.tweens.add({ targets: a.rise, v: 1, duration: 320, ease: 'Sine.Out' })
    this.actors.set(u.key, a)
    return a
  }

  dropActor (a, fade) {
    this.actors.delete(a.key)
    const all = [a.sprite, a.shadow, ...a.parts.map((x) => x.o), ...(a.growth?.parts ?? []), ...a.horde].filter(Boolean)
    if (!fade) return all.forEach((o) => o.destroy())
    this.tweens.add({ targets: all, alpha: 0, duration: 220, onComplete: () => all.forEach((o) => o.destroy()) })
  }

  // A unit's marks, made anew from its picture entry: its bars, its growth (growthMarks, as in battle), its
  // level, the glow of each synergy it counts toward, and the selection. Each part keeps an offset from the feet
  // and a layer: 'under' the unit, 'ground' with its bars, 'mark' and 'top' over everyone.
  dress (a) {
    for (const x of a.parts) x.o.destroy()
    for (const o of a.growth?.parts ?? []) o.destroy()
    a.parts = []
    a.growth = null
    const u = a.u
    const part = (o, dx, dy, layer, extra = {}) => { a.parts.push({ o, dx, dy, layer, ...extra }); return o }
    const txt = (str, size, colour, stroke = 3) => this.add.text(0, 0, str, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: '#07060b', strokeThickness: stroke }).setResolution(3)
    const foe = u.side === 'foe'
    // A stack is its horde (engine.js syncHorde): its own sprite in front, a little smaller, the rest behind it.
    const n = u.fallen ? 1 : u.count ?? 1
    a.scale = SCALE / RES * (n > 1 ? HORDE.front : 1)
    syncHorde(this, a, n, `unit:${unitDef(u.id).art}:alive`, foe)
    a.sprite.setTexture(`unit:${unitDef(u.id).art}:${u.fallen ? 'dead' : 'alive'}`)
    if (u.fallen) a.sprite.setTint(0xc4bfd0)
    else a.sprite.clearTint()
    a.ghost = u.ghost ?? 1
    const ring = (w, colour, alpha, line = 2) => part(this.add.ellipse(0, 0, w * a.size, w * 0.3 * a.size).setStrokeStyle(line, colour, alpha), 0, 4, 'under')
    const glow = (w, colour, alpha) => part(this.add.image(0, 0, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(w * a.size, w * 0.32 * a.size).setAlpha(alpha), 0, 4, 'under')
    // The synergies it counts toward (DESIGN §2.9): a ring a synergy in its colour, one inside the other, over
    // a soft pool of the first's light; a partner of the selected piece (or of a chip pressed) glows bright.
    const syn = u.glow ?? []
    if (syn.length) {
      glow(u.lit ? 120 : 92, hex(syn[0]), u.lit ? 0.85 : 0.4).setData(u.lit ? 'pulse' : 'still', true)
      syn.forEach((c, i) => ring(66 - i * 9, hex(c), u.lit ? 1 : 0.8, u.lit ? 3 : 2.2))
    }
    // The selected piece, found at a glance while its panel is open: a bright pulsing ring in a pool of light, a
    // ripple spreading from it (update), and a bobbing chevron over its head (placed first: layoutMarks).
    if (u.sel) {
      const c = foe ? FOE : SOUL
      glow(124, c, 0.6).setData('pulse', true)
      ring(76, c, 1, 4).setData('pulse', true)
      ring(76, c, 0.9, 2.5).setData('ripple', true)
      const chev = this.add.graphics()
      chev.fillStyle(c, 0.35).fillCircle(0, -6, 11)
      chev.fillStyle(c, 1).fillTriangle(-9, -11, 9, -11, 0, 0)
      chev.lineStyle(2, 0x07060b, 0.95).strokeTriangle(-9, -11, 9, -11, 0, 0)
      part(legible(chev.setData('size', 6), this.labelZ, 'num'), 0, -a.chest * 2.95 - 4, 'top', { move: 0, bob: true, box: [-11, -17, 11, 5] })
    }
    // The bars: the Monarch's thicker, in its gold frame.
    const crowned = !!u.monarch
    const colour = foe ? FOE : PARTY
    part(this.add.rectangle(0, 0, BAR + 2, crowned ? 12 : 10, 0x07060b, 0.92).setStrokeStyle(1, crowned ? CROWN : 0x2c2740), 0, BAR_DROP + 2, 'ground', { keep: true })
    const f = u.maxHp ? Math.max(0, u.hp / u.maxHp) : 1
    if (f > 0) part(this.add.rectangle(0, 0, BAR * f, crowned ? 6 : 4, colour).setOrigin(0, 0.5), -BAR / 2, BAR_DROP, 'ground', { z: 0.2, keep: true })
    // Every mark that carries print is kept legible at the board's zoom (engine.js legible), and placed by the
    // size it then has (layoutMarks nudges each clear of the rest).
    const z = this.labelZ
    const L = (o, size, kind = 'num') => legible(o.setData('size', size), z, kind)
    // Left of the feet, a stack's count (×3), on a plate in its side's colour.
    if (n > 1) {
      const t = txt(`×${n}`, 12, foe ? '#ffd0d6' : '#e6fff6', 0).setOrigin(0.5)
      const kids = [this.add.rectangle(0, 0, t.width + 10, 19, 0x07060b, 0.92).setStrokeStyle(1.5, foe ? FOE : PARTY), t]
      part(L(this.add.container(0, 0, kids), 12), -MARK_X, -7, 'mark', { z: 0.3, move: 1, box: [-(t.width + 10) / 2, -9.5, (t.width + 10) / 2, 9.5] })
    }
    // A Banner (DESIGN §2.8) flies a pennant over its shoulder; a piece of its wing a small one.
    if (u.banner || u.follows) {
      const k = u.banner ? 1 : 0.7
      const fl = this.add.graphics()
      fl.lineStyle(2, 0xdfe8ff, 0.95).lineBetween(0, 4, 0, -20 * k)
      fl.fillStyle(PLAN, 1).fillTriangle(1, -20 * k, 16 * k, -15 * k, 1, -10 * k)
      fl.lineStyle(1.2, 0x07060b, 0.9).strokeTriangle(1, -20 * k, 16 * k, -15 * k, 1, -10 * k)
      part(L(fl.setData('size', 12), 12), MARK_X - 4, -a.chest * 1.6, 'mark', { move: 2, box: [-2, -21 * k, 17 * k, 5] })
    }
    // Yours wear their growth as in battle: their tiers.
    if (!foe && !u.monarch) a.growth = growthMarks(this, u, { size: a.size })
  }

  // A unit's body as drawn at its tile (its picture's middle, from its head down to its bars), in world px.
  bodyOf (a, at = posFor(a.tile)) {
    const s = a.sprite
    const w = s.displayWidth * 0.3
    return { l: at.x - w, r: at.x + w, t: at.y - s.displayHeight * FEET * 0.92, b: at.y + BAR_DROP + 6 }
  }

  // The marks that carry print, laid out together so none covers another: the selected piece's first, then
  // front to back, each mark (by its `move`) nudged the least way clear of every one placed before it, and of
  // the board's labels and the domain's caption.
  layoutMarks () {
    const placed = []
    const units = [...this.actors.values()].sort((a, b) => (b.u.sel ? 1 : 0) - (a.u.sel ? 1 : 0) || posFor(b.tile).y - posFor(a.tile).y)
    const hasText = (o) => o.type === 'Text' || o.list?.some((c) => c.type === 'Text')
    for (const a of units) {
      const home = posFor(a.tile)
      a.growth?.place(home.x, home.y, 0, a.chest, 0)
      for (const o of a.growth?.parts ?? []) if (hasText(o)) placed.push(boundsOf(o))
      for (const x of a.parts) {
        if (x.move != null || x.layer !== 'ground' || !hasText(x.o)) continue
        x.o.setPosition(home.x + x.dx, home.y + x.dy)
        placed.push(boundsOf(x.o))
      }
    }
    for (const t of this.layer) if (t.type === 'Text' && t.visible) placed.push(boundsOf(t))
    const dom = this.placeDomain(placed)
    if (dom) placed.push(dom)
    for (const a of units) {
      const home = posFor(a.tile)
      const lane = { l: home.x - SPREAD / 2 + 2, r: home.x + SPREAD / 2 - 2 }
      for (const x of a.parts.filter((q) => q.move != null).sort((p, q) => p.move - q.move)) {
        x.bx ??= x.dx
        x.by ??= x.dy
        const s = x.o.scaleX || 1
        const at = (ox, oy) => {
          const [px, py] = [home.x + x.bx + ox, home.y + x.by + oy]
          if (x.box) return { l: px + x.box[0] * s, t: py + x.box[1] * s, r: px + x.box[2] * s, b: py + x.box[3] * s }
          const [w, h] = [x.o.displayWidth, x.o.displayHeight]
          return { l: px - w * x.o.originX, t: py - h * x.o.originY, r: px + w * (1 - x.o.originX), b: py + h * (1 - x.o.originY) }
        }
        let best = null
        for (const [ox, oy] of NUDGES) {
          const r = at(ox, oy)
          const out = Math.max(0, lane.l - r.l, r.r - lane.r)
          const cost = placed.reduce((n, q) => n + overlap(r, q), 0) + out * (r.b - r.t) * 0.25
          if (!best || cost < best.cost - 0.01) best = { cost, ox, oy, r }
          if (cost === 0) break
        }
        x.dx = x.bx + best.ox
        x.dy = x.by + best.oy
        placed.push(best.r)
      }
    }
    this.markRects = placed.filter((r) => r !== dom)
  }

  // The domain's caption, outside its box where it covers fewest of the units' bodies and of `marks` (world
  // rects; the last layout's when not given), inside the board's own box. → its rect.
  placeDomain (marks = this.markRects ?? []) {
    const t = this.domLabel
    if (!t?.active || !this.domBox) return null
    const bodies = [...this.actors.values()].filter((a) => !a.lifted).map((a) => this.bodyOf(a))
    return placeOutside(t, this.domBox, this.bounds(), [...bodies, ...marks.map((m) => ({ ...m, w: 4 }))])
  }

  update (time) {
    // Asleep while its editor is off screen (the Map or Codex tab, the spoils, a rite): the next show wakes it.
    if (!this.leaving && !want?.stage.isConnected) return this.rest()
    const v = reducedMotion() ? 0.8 : this.beat.v // the selection pulses; held still if reduced
    // While moving a piece: the lifted piece hides off the board (the editor's ghost carries it over the page),
    // and a piece the drop would displace dims.
    const drag = this.drag
    const seen = (a) => a.lifted && drag?.off ? 0 : drag?.preview?.swap?.key === a.key ? 0.35 : 1
    for (const a of this.actors.values()) {
      const s = a.sprite
      const breath = a.u.fallen || reducedMotion() ? 0 : BREATH * Math.sin(time / 640 + a.seed)
      const pop = a.pop.v
      s.setScale(a.scale * (1 + 0.14 * pop) * (0.6 + 0.4 * a.rise.v), a.scale * (1 + breath + 0.2 * pop) * (0.6 + 0.4 * a.rise.v))
      s.setDepth(a.lifted ? 9500 + s.y : s.y)
      s.setAlpha((a.lifted ? 0.92 : a.ghost) * a.rise.v * seen(a))
      const ground = a.lifted ? a.drop : { x: s.x, y: s.y }
      a.shadow.setPosition(ground.x, ground.y + 4).setDepth(ground.y - 2).setAlpha(0.5 * a.rise.v * seen(a))
      for (const x of a.parts) {
        const depth = x.layer === 'under' ? s.y - 1.4 + (x.z ?? 0) : x.layer === 'top' ? 8000 + s.y : x.layer === 'mark' ? 7000 + s.y : s.y + 0.5 + (x.z ?? 0.1)
        const bob = x.bob && !reducedMotion() ? 3 * Math.sin(time / 260) : 0
        x.o.setPosition(s.x + x.dx, s.y + x.dy + bob).setDepth(a.lifted ? depth + 9500 : depth)
        const hide = a.lifted && (x.layer === 'top' || x.layer === 'under')
        let alpha = x.o.getData?.('pulse') ? 0.55 + 0.45 * v : 1
        // The selection's ripple spreads and fades, once a second (none under reduced motion).
        if (x.o.getData?.('ripple')) {
          const t = (time % 1100) / 1100
          x.o.setScale(1 + 0.7 * t)
          alpha = reducedMotion() ? 0 : 0.9 * (1 - t)
        }
        const base = x.o.getData?.('still') ? x.o.alpha : 1
        if (!x.o.getData?.('still')) x.o.setAlpha(hide ? 0 : alpha * a.rise.v * (x.layer === 'ground' && a.ghost < 1 ? 0.8 : 1) * seen(a))
        else x.o.setVisible(!hide && base > 0)
      }
      a.growth?.place(s.x, s.y, s.depth, a.chest, 0)
      for (const o of a.growth?.parts ?? []) o?.setVisible(seen(a) > 0)
      placeHorde(a, s.x, s.y, s.depth, SCALE / RES * (0.6 + 0.4 * a.rise.v), s.alpha, breath)
    }
    this.glowG.setAlpha(0.55 + 0.45 * v)
    this.live(v)
    this.easing(time)
    this.pan()
    this.fit()
    this.glide()
  }

  // Off screen: let go of a drag and the hover, and sleep (no update, no render) until board.show wakes it.
  rest () {
    this.dropped()
    this.unzoom()
    this.hovered = null
    this.fitKey = ''
    this.sys.sleep()
  }

  // Redrawn every frame: the tile under the pointer, the keyboard's tile, and while a piece is moved the drop
  // tile, green or red.
  live (v) {
    const g = this.liveG.clear()
    const p = this.picture
    if (!p || this.leaving) return
    if (this.focused != null && !this.drag) {
      const { x, y } = posFor(this.focused)
      g.lineStyle(2, 0xffffff, 0.6 + 0.35 * v).strokeRoundedRect(x - SPREAD / 2 + 5, y + GROUND - ROW_PX / 2 + 5, SPREAD - 10, ROW_PX - 10, 8)
    }
    const d = this.drag?.piece ? this.drag : null
    const at = d ? d.preview?.tile : !this.drag && typeof this.hovered === 'number' ? this.hovered : null
    if (at == null) return
    const { x, y } = posFor(at)
    if (d) {
      const ok = d.preview.ok
      g.fillStyle(ok ? SOUL : FOE, 0.12).fillEllipse(x, y + GROUND, 66, 21)
      g.lineStyle(2.5, ok ? SOUL : FOE, 0.95).strokeEllipse(x, y + GROUND, 66, 21)
      // A stack onto a piece of its kind: a second ring, pulsing, round the first.
      if (d.preview.stack) g.lineStyle(2, SOUL, 0.4 + 0.5 * v).strokeEllipse(x, y + GROUND, 84, 28)
    } else g.lineStyle(1.5, 0xffffff, 0.55).strokeEllipse(x, y + GROUND, 58, 18)
  }

  // A pop of soulfire on a unit that just grew: it swells and sparks. Under reduced motion it does not.
  pop (key) {
    const a = this.actors.get(key)
    if (!a || reducedMotion()) return
    this.tweens.add({ targets: a.pop, v: { from: 1, to: 0 }, duration: 460, ease: 'Quad.Out' })
    const s = a.sprite
    const ring = this.add.image(s.x, s.y + 4, 'glow').setTint(SOUL).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(30, 10).setAlpha(0.9).setDepth(s.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 120, displayHeight: 36, alpha: 0, duration: 560, ease: 'Cubic.Out', onComplete: () => ring.destroy() })
    this.sparks.explode(12, s.x, s.y - a.chest)
  }

  // ── the camera ───────────────────────────────────────────────────────────────────────────────

  // The world box the board takes: the board, room above their back row for heads and the label, and under the
  // camp for the bars.
  bounds () {
    return { l: -BAND / 2 - 6, r: BAND / 2 + 6, t: rowY(DEPTH - 1) - ROW_PX / 2 - TOP, b: EDGE + 34 }
  }

  // Fits the board inside the stage's rect (in the viewport, so a scroll or a resize carries it along), clear
  // of the `avoid` elements laid over the stage (see around). Checked every frame; it only moves when something
  // did.
  fit () {
    const w = want
    // A drag's eased-in view holds until the camera is back on the board's own (dragView).
    if (!w?.stage.isConnected || this.leaving || this.camAnim || this.drag?.zoomed) return
    const r = w.stage.getBoundingClientRect()
    const c = this.game.canvas.getBoundingClientRect()
    const els = w.avoid.filter((e) => e.isConnected)
    const b = this.bounds()
    const cam = this.cameras.main
    const keyOf = () => [r.left, r.top, r.width, r.height, c.left, c.top, c.width, c.height,
      ...els.flatMap((e) => { const a = e.getBoundingClientRect(); return [a.left, a.top, a.right, a.bottom] })].join()
    if (!r.width || !r.height || keyOf() === this.fitKey) return
    const v = this.around(r, b, els)
    cam.setViewport(0, 0, Math.round(c.width), Math.round(c.height))
    const [ox, oy] = [c.left + cam.x, c.top + cam.y]
    const mx = v.wx - (v.sx - ox - cam.width / 2) / v.z
    const my = v.wy - (v.sy - oy - cam.height / 2) / v.z
    cam.setZoom(v.z)
    cam.centerOn(mx, my)
    const was = this.labelZ
    this.view = this.fitted = { mx, my, z: v.z, w: cam.width, h: cam.height, ox, oy }
    this.fitKey = keyOf()
    // A new zoom: the labels laid out by their size are laid out again at it; a small change only rescales them.
    if (this.picture && (was == null || Math.abs(v.z / was - 1) > 0.02)) {
      this.draw(this.picture)
      this.fitKey = keyOf()
    } else {
      for (const t of [...this.layer, this.domLabel]) if (t?.getData?.('legible')) legible(t, v.z)
      for (const a of this.actors.values()) {
        for (const x of a.parts) if (x.o.getData?.('legible')) legible(x.o, v.z)
      }
      this.layoutMarks()
    }
  }

  // A drag by touch on a board whose tiles stand under DRAG.zoomUnder CSS px (a phone's): the view it eases in
  // to, the point under the finger (fx, fy) kept under it. A piece's: your camp and the open ground with their
  // front row's feet as large as the stage holds (at most DRAG.zoom×), kept inside the stage as far as it fits.
  // A line's (`line`): DRAG.zoom× on the finger, the board's edges kept to the stage's (it pans on: see pan).
  // Null when that would hardly zoom.
  dragView (fx, fy, line = false) {
    const f = this.fitted
    if (!f || !want?.stage.isConnected || ROW_PX * f.z >= DRAG.zoomUnder) return null
    const r = want.stage.getBoundingClientRect()
    const box = line ? this.bounds() : { l: -BAND / 2 - 6, r: BAND / 2 + 6, t: rowY(CAMP_ROWS + 1) - 30, b: EDGE + 34 }
    const z = line ? f.z * DRAG.zoom : Math.min(r.height / (box.b - box.t), r.width / (box.r - box.l), f.z * DRAG.zoom)
    if (z < f.z * 1.08) return null
    const p = this.toWorld(fx, fy)
    const v = { ...f, z, mx: p.x - (fx - f.ox - f.w / 2) / z, my: p.y - (fy - f.oy - f.h / 2) / z }
    return this.keepIn(v, box, r)
  }

  // View v with world box `box` kept to the stage's rect `r`, each way: inside it where the box is the smaller,
  // else with no gap at either of its edges.
  keepIn (v, box, r) {
    const keep = (lo, hi, m, half, o, a, b) => {
      const [s0, s1] = [o + (lo - m) * v.z + half, o + (hi - m) * v.z + half]
      if (s1 - s0 > b - a) return s0 > a ? m + (s0 - a) / v.z : s1 < b ? m - (b - s1) / v.z : m
      return s0 < a ? m - (a - s0) / v.z : s1 > b ? m + (s1 - b) / v.z : m
    }
    return { ...v, mx: keep(box.l, box.r, v.mx, v.w / 2, v.ox, r.left, r.right), my: keep(box.t, box.b, v.my, v.h / 2, v.oy, r.top, r.bottom) }
  }

  // The camera onto view v ({ mx, my, z, … }), and the board's mapping with it.
  applyView (v) {
    const cam = this.cameras.main
    cam.setZoom(v.z)
    cam.centerOn(v.mx, v.my)
    this.view = v
  }

  // The camera eases from where it stands to view `to` (DRAG.ms; at once under reduced motion); `back`: to the
  // board's own view, after which fit takes over again.
  easeTo (to, back = false) {
    this.camAnim = { from: this.view, to, t0: this.time.now, ms: reducedMotion() ? 0 : DRAG.ms, back }
  }

  // Each frame while the camera eases (update): the view between, and the lifted piece kept under the finger.
  easing (time) {
    const a = this.camAnim
    if (!a) return
    const t = a.ms ? Math.min(1, (time - a.t0) / a.ms) : 1
    const e = t * t * (3 - 2 * t)
    const lerp = (k) => a.from[k] + (a.to[k] - a.from[k]) * e
    this.applyView({ ...a.to, z: a.from.z * Math.pow(a.to.z / a.from.z, e), mx: lerp('mx'), my: lerp('my') })
    if (this.drag?.piece && this.drag.fx != null) this.follow(this.drag.fx, this.drag.fy)
    if (t < 1) return
    this.camAnim = null
    if (a.back) this.fitKey = ''
  }

  // A line drawn in an eased-in view: while the finger stands near the stage's edge (DRAG.pan of its size) the
  // view pans on that way, as far as the board goes, and the line follows the finger's new tile (onPan).
  pan () {
    const d = this.drag
    if (!d?.line || !d.zoomed || this.camAnim || d.fx == null || !want?.stage.isConnected) return
    const r = want.stage.getBoundingClientRect()
    const near = (x, lo, hi) => {
      const band = (hi - lo) * DRAG.pan
      return x < lo + band ? -(1 - (x - lo) / band) : x > hi - band ? 1 - (hi - x) / band : 0
    }
    const [kx, ky] = [near(d.fx, r.left, r.right), near(d.fy, r.top, r.bottom)]
    if (!kx && !ky) return
    const v = this.view
    const next = this.keepIn({ ...v, mx: v.mx + kx * DRAG.panPx / v.z, my: v.my + ky * DRAG.panPx / v.z }, this.bounds(), r)
    if (Math.abs(next.mx - v.mx) < 0.01 && Math.abs(next.my - v.my) < 0.01) return
    this.applyView(next)
    d.onPan?.(d.fx, d.fy)
  }

  // Back to the board's own view at once (a handoff, a rest).
  unzoom () {
    this.camAnim = null
    if (this.fitted && this.view !== this.fitted) this.applyView(this.fitted)
  }

  // The biggest board the stage holds clear of the overlays: each overlay it would cover is cleared either
  // beside the board (a column off that side) or over it (a band off the top), every way tried.
  around (r, b, els) {
    const [bw, bh] = [b.r - b.l, b.b - b.t]
    const solve = (g) => {
      const [w, h] = [Math.max(60, g.r - g.l), Math.max(60, g.b - g.t)]
      const z = Math.max(0.25, Math.min(1.35, (w - 8) / bw, (h - 6) / bh))
      const [cx, cy] = [g.l + w / 2, g.t + h / 2]
      return { g, z, cx, cy, box: { l: cx - bw / 2 * z, r: cx + bw / 2 * z, t: cy - bh / 2 * z, b: cy + bh / 2 * z } }
    }
    const clear = (v, rs) => {
      const x = v.box
      const i = rs.findIndex((a) => !(a.right <= x.l || a.left >= x.r || a.bottom <= x.t || a.top >= x.b))
      if (i < 0) return v
      const a = rs[i]
      const rest = rs.filter((_, k) => k !== i)
      const left = a.left + a.width / 2 < (v.g.l + v.g.r) / 2
      return [left ? { ...v.g, l: Math.max(v.g.l, a.right + 6) } : { ...v.g, r: Math.min(v.g.r, a.left - 6) }, { ...v.g, t: Math.max(v.g.t, a.bottom + 6) }]
        .map((g) => clear(solve(g), rest)).reduce((m, n) => (n.z > m.z + 1e-3 ? n : m))
    }
    const v = clear(solve({ l: r.left, r: r.right, t: r.top, b: r.bottom }), els.map((e) => e.getBoundingClientRect()).filter((a) => a.width && a.height))
    return { z: v.z, wx: (b.l + b.r) / 2, wy: (b.t + b.b) / 2, sx: v.cx, sy: v.cy }
  }

  toWorld (x, y) {
    const v = this.view
    return { x: v.mx + (x - v.ox - v.w / 2) / v.z, y: v.my + (y - v.oy - v.h / 2) / v.z }
  }

  toScreen (x, y) {
    const v = this.view
    return { x: v.ox + (x - v.mx) * v.z + v.w / 2, y: v.oy + (y - v.my) * v.z + v.h / 2 }
  }

  // The tile under a viewport point. A unit's drawn body takes the point first (the front-most whose body holds
  // it), so a press on a head picks that unit, not the tile behind it; then the tile whose cell holds it. While
  // a piece is moved by touch the drop goes by its feet, drawn DRAG.lift above the finger (follow); while a line
  // is drawn, by the ground under the finger.
  tileAt (x, y) {
    if (!this.view) return null
    const feet = !!this.drag?.piece && this.drag.touch
    const p = this.toWorld(x, feet ? y - DRAG.lift : y)
    if (!this.drag) {
      // By touch, a press just off a body (TOUCH_SLOP CSS px) picks it too.
      const slop = pointerType !== 'touch' ? 0 : TOUCH_SLOP / this.view.z
      let best = null
      for (const a of this.actors.values()) {
        if (a.rise.v < 1 || a.sprite.alpha < 0.05) continue
        const b = this.bodyOf(a, { x: a.sprite.x, y: a.sprite.y })
        const d = Math.hypot(Math.max(0, b.l - p.x, p.x - b.r), Math.max(0, b.t - p.y, p.y - b.b))
        if (d > slop) continue
        const rank = d > 0 ? -d : 1e4 + a.sprite.y
        if (!best || rank > best.rank) best = { a, rank }
      }
      if (best) return best.a.tile
    }
    if (Math.abs(p.x) > LANES / 2 * SPREAD) return null
    const tx = Math.round(p.x / SPREAD + (LANES - 1) / 2)
    let ty = Math.round((DEPTH - 1) / 2 - (p.y + (feet || this.drag?.line ? -GROUND : HIT_UP)) / ROW_PX)
    // The rear row's bars, and their back row's heads, still count as theirs.
    if (ty === -1 && p.y <= EDGE + 30) ty = 0
    if (ty === DEPTH && p.y >= -EDGE - 96) ty = DEPTH - 1
    return ty >= 0 && ty < DEPTH ? tileOf(tx, ty) : null
  }

  // The line whose marker holds a viewport point: within its disc, or MARKER_HIT CSS px of its centre (the
  // nearest such); null with none.
  markerAt (x, y) {
    if (!this.view || this.drag) return null
    const p = this.toWorld(x, y)
    let best = null
    for (const m of this.markerHits) {
      const d = Math.hypot(p.x - m.x, p.y - m.y)
      if (d <= Math.max(m.r, MARKER_HIT / this.view.z) && (!best || d < best.d)) best = { uid: m.uid, d }
    }
    return best?.uid ?? null
  }

  rectOf (tile) {
    if (!this.view || tile == null) return null
    const p = posFor(tile)
    const a = this.toScreen(p.x - SPREAD / 2, p.y - HIT_UP - ROW_PX / 2)
    const z = this.toScreen(p.x + SPREAD / 2, p.y - HIT_UP + ROW_PX / 2)
    return { left: a.x, top: a.y, right: z.x, bottom: z.y }
  }

  markerRect (uid) {
    const m = this.view && this.markerHits.find((x) => x.uid === uid)
    if (!m) return null
    const a = this.toScreen(m.x - m.r, m.y - m.r)
    const z = this.toScreen(m.x + m.r, m.y + m.r)
    return { left: a.x, top: a.y, right: z.x, bottom: z.y }
  }

  // ── moving a piece ───────────────────────────────────────────────────────────────────────────

  lift (what, x, y) {
    if (this.drag) this.dropped()
    const a = typeof what === 'string' ? this.actors.get(what) : null
    let sprite = a?.sprite
    let ghost = null
    if (a) {
      this.tweens.killTweensOf(sprite)
      a.lifted = true
      a.drop = posFor(a.tile)
    } else {
      ghost = this.add.image(0, 0, `unit:${unitDef(what.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES).setAlpha(0.92).setDepth(9500)
      sprite = ghost
    }
    this.drag = { piece: true, key: a ? what : null, a, sprite, ghost, chest: a?.chest ?? 30, preview: null, touch: pointerType === 'touch' }
    // By touch on a small board the camera eases in on the camp for the drag (dragView), back out on the drop.
    const v = this.drag.touch && this.dragView(x, y)
    if (v) {
      this.drag.zoomed = true
      this.easeTo(v)
    }
    this.follow(x, y, null)
  }

  // The lifted piece follows the pointer (its feet under it); a new `preview` ({ tile, ok, centre, roads, swap })
  // moves the domain to where it would centre and the roads to where they would run (a dragged Monarch carries
  // both), and shows a piece it would displace, ghosted on the tile it would go to.
  follow (x, y, preview, off = this.drag?.off) {
    const d = this.drag
    if (!d?.piece || !this.view) return
    d.off = off
    d.ghost?.setVisible(!off)
    if (x != null) {
      d.fx = x
      d.fy = y
      // By mouse the pointer holds it by the chest; by touch it stands above the finger, its feet DRAG.lift up.
      const p = d.touch ? this.toWorld(x, y - DRAG.lift) : this.toWorld(x, y)
      const feet = d.touch ? p.y : p.y + d.chest
      d.sprite.setPosition(p.x, feet)
      if (d.a) d.a.drop = d.preview?.tile != null ? posFor(d.preview.tile) : { x: p.x, y: feet }
    }
    if (preview === undefined) return
    d.preview = preview
    if (d.a) d.a.drop = preview?.tile != null ? posFor(preview.tile) : d.a.drop
    this.drawDomain(preview?.centre ?? this.picture.domain?.centre ?? null)
    this.drawRoads(preview?.roads ?? this.picture.roads)
    this.swapGhost?.destroy()
    this.swapGhost = null
    const sw = preview?.swap
    if (sw?.to != null) {
      const c = posFor(sw.to)
      this.swapGhost = this.add.image(c.x, c.y, `unit:${unitDef(sw.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES)
        .setAlpha(0.5).setTint(SOUL).setDepth(c.y)
    }
  }

  // ── drawing a line ───────────────────────────────────────────────────────────────────────────

  trace (x, y, onPan) {
    if (this.drag) this.dropped()
    this.drag = { line: true, fx: x, fy: y, onPan, touch: pointerType === 'touch' }
    const v = this.drag.touch && this.dragView(x, y, true)
    if (v) {
      this.drag.zoomed = true
      this.easeTo(v)
    }
  }

  // The line as it is drawn ({ from, tiles, ok }): bold, over everything, each of its tiles lit, its end a ring
  // where the finger is, and its length in steps; red where it can go no further.
  sketch (line, x, y) {
    const d = this.drag
    if (!d?.line) return
    if (x != null) { d.fx = x; d.fy = y }
    const g = this.sketchG.clear()
    this.sketchText?.destroy()
    this.sketchText = null
    if (!line) return
    const pts = [line.from, ...line.tiles].map(groundOf)
    for (const t of line.tiles) {
      const q = groundOf(t)
      g.fillStyle(PLAN, 0.16).fillEllipse(q.x, q.y, 60, 20)
    }
    g.lineStyle(10, 0x07060b, 0.55).strokePoints(pts, false)
    g.lineStyle(6, PLAN, 1).strokePoints(pts, false)
    if (pts.length > 1) arrowHead(g, pts.at(-2), pts.at(-1), PLAN, 1, 17)
    const end = pts.at(-1)
    g.lineStyle(3, line.ok === false ? FOE : 0xffffff, 0.95).strokeEllipse(end.x, end.y, 64, 22)
    if (line.tiles.length) {
      this.sketchText = legible(this.add.text(end.x, end.y - 30, String(line.tiles.length), { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: '#ffffff', stroke: '#07060b', strokeThickness: 4 })
        .setResolution(3).setOrigin(0.5, 1).setDepth(9610).setData('size', 13), this.view?.z, 'num')
    }
  }

  // A drag ends, either kind: the lifted piece goes home (the editor's next picture places it), the sketch goes,
  // and an eased-in camera eases back to the board's own view.
  dropped () {
    const d = this.drag
    if (!d) return
    this.drag = null
    d.ghost?.destroy()
    this.swapGhost?.destroy()
    this.swapGhost = null
    this.sketchG.clear()
    this.sketchText?.destroy()
    this.sketchText = null
    if (d.a) {
      d.a.lifted = false
      const home = posFor(d.a.tile)
      this.tweens.add({ targets: d.a.sprite, x: home.x, y: home.y, duration: 200, ease: 'Sine.Out' })
    }
    if (this.picture && d.piece) {
      this.drawDomain(this.picture.domain?.centre ?? null)
      this.drawRoads(this.picture.roads)
    }
    if (d.zoomed && this.fitted) this.easeTo(this.fitted, true)
  }

  // ── into the battle ──────────────────────────────────────────────────────────────────────────

  // The battle is built under this picture: it plays one frame (its units take their size) and holds, the prep
  // marks fade, and once that heavy first frame is past the camera glides to the battle's view and the board
  // fades into the battle's own, which starts as it shows. The battle may end at any moment of it (Skip): then
  // the handoff stops where it is, and so does this scene; a stopped battle is never resumed.
  handoff (battle) {
    if (!this.leaving || !this.sys.isActive()) return
    if (this.drag) this.dropped()
    this.unzoom()
    this.hovered = null
    this.focused = null
    this.scene.bringToTop()
    // What the battle draws too (the bars, the growth) stays; the rest fades.
    const marks = [this.roadG, this.ringG, this.lineG, this.markG, this.domG, this.liveG, this.domLabel, ...this.layer,
      ...[...this.actors.values()].flatMap((a) => a.parts.filter((x) => !x.keep).map((x) => x.o))].filter(Boolean)
    for (const a of this.actors.values()) a.parts = a.parts.filter((x) => x.keep)
    this.tweens.add({ targets: marks, alpha: 0, duration: 260 })
    // step: 'build' until the battle's first frame, 'held' (counting frames), 'glide', then 'fade'.
    const h = { battle, step: 'build', frames: 0 }
    const held = () => {
      if (this.into !== h) return
      battle.scene.pause()
      h.step = 'held'
    }
    const ended = () => this.abort(h)
    h.off = () => {
      battle.events.off('postupdate', held)
      battle.events.off('shutdown', ended)
    }
    battle.events.once('postupdate', held)
    battle.events.once('shutdown', ended)
    this.into = h
  }

  // Called each frame while handing off: two frames after the battle held, the glide, then the fade. Under
  // reduced motion there is no glide: the camera cuts to the battle's view and the board cross-fades into it.
  glide () {
    const h = this.into
    if (h?.step !== 'held' || ++h.frames < 2) return
    h.step = 'glide'
    const bc = h.battle.cameras.main
    const cam = this.cameras.main
    const fade = () => {
      if (this.into !== h) return
      h.step = 'fade'
      h.off()
      if (h.battle.sys.isPaused()) h.battle.scene.resume()
      this.tweens.add({ targets: cam, alpha: 0, duration: reducedMotion() ? 160 : 280, onComplete: () => this.abort(h) })
    }
    if (reducedMotion()) {
      cam.setZoom(bc.zoom)
      cam.centerOn(bc.scrollX + bc.width / 2, bc.scrollY + bc.height / 2)
      return fade()
    }
    cam.pan(bc.scrollX + bc.width / 2, bc.scrollY + bc.height / 2, 460, Phaser.Math.Easing.Sine.InOut)
    cam.zoomTo(bc.zoom, 460, Phaser.Math.Easing.Sine.InOut)
    cam.once('camerazoomcomplete', fade)
  }

  // The handoff ends, done or cut short (the battle stopped under it, or never came): this scene stops, and
  // starts afresh (not leaving) the next time a board is shown.
  abort (h = this.into) {
    if (h !== this.into) return
    h?.off()
    this.into = null
    this.leaving = false
    if (this.sys.isActive() || this.sys.isSleeping()) this.scene.stop()
  }
}

// The ways a mark may be nudged off its place (world px), least first: up before down, then a little sideways.
const NUDGES = (() => {
  const out = []
  for (let oy = -48; oy <= 12; oy += 3) for (const ox of [0, -5, 5, -10, 10, -16, 16]) out.push([ox, oy])
  return out.sort((a, b) => (Math.abs(a[1]) * (a[1] > 0 ? 1.6 : 1) + 1.4 * Math.abs(a[0])) - (Math.abs(b[1]) * (b[1] > 0 ? 1.6 : 1) + 1.4 * Math.abs(b[0])))
})()

// An object's world rect ({ l, t, r, b }) as drawn (a text, a container of shapes and texts).
function boundsOf (o) {
  const b = o.getBounds()
  return { l: b.x, t: b.y, r: b.x + b.width, b: b.y + b.height }
}

// Whether a unit grew between two pictures: a level, a tier, its count, its HP.
const grew = (a, b) => a.lvl !== b.lvl || String(a.tracks) !== String(b.tracks) || a.count !== b.count || a.maxHp !== b.maxHp

// An arrowhead `size` long at q, pointing on from p.
function arrowHead (g, p, q, colour, alpha, size) {
  const len = Math.hypot(q.x - p.x, q.y - p.y)
  if (len < 1) return
  const [ux, uy] = [(q.x - p.x) / len, (q.y - p.y) / len]
  const [bx, by] = [q.x - ux * size, q.y - uy * size]
  const w = size * 0.55
  g.fillStyle(colour, alpha).fillTriangle(q.x + ux * 3, q.y + uy * 3, bx - uy * w, by + ux * w, bx + uy * w, by - ux * w)
}

// A dashed line from (x1, y1) to (x2, y2): what is not your own line, a follower's march.
function dashed (g, x1, y1, x2, y2, dash = 7, gap = 5) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  if (!len) return
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len]
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash)
    g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e)
  }
}
