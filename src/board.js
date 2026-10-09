// The prep board: the battle's own board, drawn in Phaser under the retinue editor (prep, and the map's Camp),
// so the army is arranged on the very picture the battle plays on. It draws a picture of plain data that the
// editor builds on every render (ui.js, retinueEditor: boardPicture), tells the editor which tile lies under
// the pointer, lifts a soul while it is dragged, and at Begin fades into the battle with everyone where they
// stood. It decides nothing: every rule, every tooltip and every action stays in ui.js.
import Phaser from './vendor/phaser.js'
import { TUNING } from './tuning.js'
import { unitDef } from './content.js'
import { LANES, DEPTH, TILES, ROWS, CAMP_ROWS, tileX, tileY, tileAt as tileOf } from './sim/unit.js'
import {
  RES, FEET, SCALE, ROW_PX, SPREAD, EDGE, rowY, WALLS, WALL_FOOT, WALL_SCALE, RANK_SCALE, BAR, BAR_DROP, BREATH,
  PARTY, FOE, SOUL, GOLD, CROWN, MARSHAL, DOMAIN, NEUTRAL, C, FONT, hex, insignia, growthMarks, palette, reducedMotion, legible,
  labelScale, domainLabel, placeOutside, overlap, faceFor, falterGround
} from './engine.js'
import { sfx } from './sfx.js'

const BAND = LANES * SPREAD + 90 // the dais under each side, as the battle draws it
const HIT_UP = 20                // a tile takes the pointer over its unit's body: centred this far above the feet
const MARK_X = 32                // the marks beside a unit's feet stand this far either side of it (a lane is SPREAD)
const TOP = 82                   // above their back row's tiles: its heads, and the label over them
// The system colours come from engine.js (C, read off style.css's tokens: see palette): a falter tag in the
// foes' red as its keyword, the domain and the line in the domain's lime, an orders pick in the orders' blue.
const ROSE = '#f08a98'
const PLAN = 0.75                // the plans here are what you are setting: drawn stronger than the battle's
const WHERE = { hunt: '', stay: ' ■', move: ' →' }
// A drag by touch: the soul is drawn LIFT CSS px above the finger (feet first), so the finger hides neither it
// nor the tile it would land on, and the drop goes by its feet. Where a tile stands under ZOOM_UNDER CSS px tall
// (a phone's whole board), the camera eases in on the camp for the drag and back out after (dragView).
export const DRAG = { lift: 48, zoomUnder: 40, ms: 200 }
const TOUCH_SLOP = 8
// The pointer of the last press (touch or not), read when a drag lifts.
let pointerType = 'mouse'
// A held start's tag, in capitals but for its seconds: "STRUCK", "20 s".
export const capsTag = (t) => t.toUpperCase().replace(/(\d) S$/, '$1 s')
const posFor = (tile) => ({ x: (tileX(tile) - (LANES - 1) / 2) * SPREAD, y: rowY(tileY(tile)) })

let engine = null
let scene = null    // the PrepScene while it runs
let starting = false
// What to show: { stage (the editor's board element, which the camera keeps the board inside), avoid (the
// elements laid over the stage, kept clear: the waves still to come, the legend), picture }.
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

  // Draws `picture` (see boardPicture in ui.js) inside `stage`; starts the scene the first time, and wakes it
  // when it slept (see update). A stage not on the page is drawn once it is, if that is still its last picture
  // (an editor builds before its screen goes up); one that never arrives, or left (an old screen's), is ignored.
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

  // The board tile under a viewport point, 'reserve' over the bodies behind the camp, or null.
  tileAt: (x, y) => scene?.tileAt(x, y) ?? null,
  // A tile's (or 'reserve''s) rect in viewport pixels, for its tooltip.
  rectOf: (tile) => scene?.rectOf(tile) ?? null,
  hover (tile) { if (scene) scene.hovered = tile },
  // Dragging: lift a board unit by its key (or a benched soul, { id }), follow the pointer with what a drop there
  // would do (`preview`, see the editor's dragPreview), and put it down (the editor's next picture places it).
  lift (what, x, y) { scene?.lift(what, x, y) },
  // `off`: the pointer is off the board (over the bench, the tray): the lifted soul hides (the editor shows it).
  follow (x, y, preview, off = false) { scene?.follow(x, y, preview, off) },
  drop () { scene?.dropped() },
  // A purchase or a change to one unit (by key): a pop of light on it.
  pop (key) { scene?.pop(key) },
  // The board's zoom: viewport pixels to a world pixel (a unit's picture is about 90 tall).
  zoom: () => scene?.view?.z ?? 1,
  // The keyboard's tile (a ring of its own while the board has focus), or null.
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
    this.actors = new Map() // key → { sprite, shadow, scale, chest, tile, u, parts, growth, mark, pop, lifted }
    this.layer = []         // the picture's texts and glows, made anew on every draw
    this.picture = null
    this.view = null        // the camera's mapping (see fit)
    this.fitted = null      // the board's own view, the one fit chose; a drag by touch may ease in from it (dragView)
    this.camAnim = null     // { from, to, t0, ms, back }: the camera easing between the two
    this.fitKey = ''
    this.hovered = null
    this.focused = null
    this.drag = null
    this.swapGhost = null
    this.leaving = false
    this.into = null
    this.beat = { v: 0 }
    this.tweens.add({ targets: this.beat, v: 1, duration: 750, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    this.ground()
    this.wallArt = { key: null, art: [] }
    this.tileG = this.add.graphics().setDepth(-400)
    this.domG = this.add.graphics().setDepth(-395)
    // While a soul is dragged: the domain lit (pulsing, see update) and the ground outside it dimmed.
    this.glowG = this.add.graphics().setDepth(-394)
    this.dimG = this.add.graphics().setDepth(-393)
    this.planG = this.add.graphics().setDepth(-386)
    this.liveG = this.add.graphics().setDepth(-384) // redrawn every frame: approach, hover, aim, drop target
    this.overG = this.add.graphics().setDepth(9600) // while dragging: where bodies would falter
    this.overText = []
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
    // The vignette, and past it the dark it fades to: the stage may be far wider than the battle's view.
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

  draw (p) {
    const old = this.picture
    this.picture = p
    for (const o of this.layer) o.destroy()
    this.layer = []
    this.drawWalls(p.walls)
    this.drawTiles(p)
    this.drawDomain(p.domain?.centre ?? null)
    this.drawPlans(p)
    this.drawLabels(p)
    this.drawWaiting(p)
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
    if (this.drag) this.follow(null, null, this.drag.preview)
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

  // A rune under every open tile, in its side's colour; brighter where someone stands, where a selected soul
  // may go (`drop`), and under a selected empty cell.
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
      g.lineStyle(1.2, colour, taken.has(tile) ? 0.45 : p.aim ? 0.32 : 0.14).strokeEllipse(x, y + 6, 50, 15)
      if (drop.has(tile)) {
        g.fillStyle(SOUL, 0.08).fillEllipse(x, y + 6, 56, 18)
        g.lineStyle(1.5, SOUL, 0.55).strokeEllipse(x, y + 6, 56, 18)
      }
      if (tile === p.selTile) {
        g.fillStyle(SOUL, 0.14).fillEllipse(x, y + 6, 62, 20)
        g.lineStyle(2.5, SOUL, 0.95).strokeEllipse(x, y + 6, 62, 20)
      }
    }
  }

  // The Monarch's domain (as the battle's drawDomain, gold under Vanguard Crown) around `centre`, each Marshal's
  // own as a dashed square in its banner's colour, and the line. While a soul is dragged the domain lights up,
  // the ground outside it dims, and it follows the drop (a dragged Monarch carries it); a dragged Marshal
  // carries its own.
  drawDomain (centre) {
    const p = this.picture
    const g = this.domG.clear()
    const glow = this.glowG.clear()
    const dim = this.dimG.clear()
    this.domLabel?.destroy()
    this.domLabel = null
    const drag = this.drag
    const d = p.domain
    if (d && centre != null) {
      const [mx, my, r] = [tileX(centre), tileY(centre), d.r]
      const [x0, x1] = [Math.max(0, mx - r), Math.min(LANES - 1, mx + r)]
      const [y0, y1] = [Math.max(0, my - r), Math.min(DEPTH - 1, my + r)]
      const left = (x0 - (LANES - 1) / 2) * SPREAD - SPREAD / 2 + 4
      const right = (x1 - (LANES - 1) / 2) * SPREAD + SPREAD / 2 - 4
      const top = rowY(y1) - ROW_PX / 2 + 2
      const bottom = rowY(y0) + ROW_PX / 2 - 2
      const colour = d.crowned ? GOLD : DOMAIN
      g.fillStyle(DOMAIN, 0.045).fillRoundedRect(left, top, right - left, bottom - top, 12)
      g.lineStyle(1.5, colour, 0.45).strokeRoundedRect(left, top, right - left, bottom - top, 12)
      if (drag) {
        glow.fillStyle(DOMAIN, 0.17).fillRoundedRect(left, top, right - left, bottom - top, 12)
        glow.lineStyle(3, colour, 0.95).strokeRoundedRect(left, top, right - left, bottom - top, 12)
        const far = 5000
        dim.fillStyle(0x05040a, 0.45)
          .fillRect(-far, -far, 2 * far, top + far).fillRect(-far, bottom, 2 * far, far)
          .fillRect(-far, top, left + far, bottom - top).fillRect(right, top, far, bottom - top)
      }
      // Just outside the box, as the battle's (engine.js domainLabel), over the units, at the corner that covers
      // fewest of their bodies and marks (placeDomain).
      this.domLabel = domainLabel(this, r, d.crowned).setDepth(7900)
      this.domBox = { l: left, r: right, t: top, b: bottom }
      legible(this.domLabel, this.labelZ, 'word')
      this.placeDomain()
      if (d.crowned) {
        const c = posFor(centre)
        g.fillStyle(GOLD, 0.12).fillEllipse(c.x, c.y + 6, 80, 24)
      }
    }
    const reach = TUNING.ranks.domain + 0.5
    for (const m of p.marshals) {
      const at = drag?.key === m.key && drag.preview?.tile != null ? drag.preview.tile : m.tile
      const c = posFor(at)
      const left = Math.max(-LANES / 2 * SPREAD + 8, c.x - reach * SPREAD + 8)
      const right = Math.min(LANES / 2 * SPREAD - 8, c.x + reach * SPREAD - 8)
      const top = Math.max(rowY(DEPTH - 1) - ROW_PX / 2 + 8, c.y - reach * ROW_PX + 8)
      const bottom = Math.min(rowY(0) + ROW_PX / 2 - 8, c.y + reach * ROW_PX - 8)
      g.fillStyle(hex(m.colour), 0.04).fillRect(left, top, right - left, bottom - top)
      g.lineStyle(1.5, hex(m.colour), 0.7)
      dashedRect(g, left, top, right - left, bottom - top)
    }
    // The line: the front of the front-most row anyone starts on.
    if (p.line != null && !drag) {
      const y = rowY(p.line) - ROW_PX / 2 + 8
      g.lineStyle(1.5, SOUL, 0.35)
      dashed(g, -LANES / 2 * SPREAD + 6, y, LANES / 2 * SPREAD - 6, y, 4, 6)
      // Right of the lanes; left of them while the bodies waiting behind the camp stand on the right (drawWaiting).
      const left = !!this.waitSide && !!p.waiting
      const t = this.add.text((left ? -1 : 1) * (LANES / 2 * SPREAD + 4), y, 'LINE', { fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: C.soul2, stroke: '#07060b', strokeThickness: 3 })
        .setResolution(3).setOrigin(left ? 1 : 0, 0.5).setDepth(-390)
      this.layer.push(legible(t, this.labelZ))
    }
  }

  // Each Move square in its detachment's colour (faded and dashed outside the domain: a one-way trip), with its
  // tags, and an arrow to it from its souls (dashed from the Monarch for a held one: it enters beside it).
  drawPlans (p) {
    const g = this.planG.clear()
    const [w, hgt] = [SPREAD - 14, ROW_PX - 14]
    for (const q of p.squares) {
      const c = posFor(q.tile)
      const colour = hex(q.color)
      const alpha = q.far ? PLAN * 0.5 : PLAN
      g.fillStyle(colour, alpha * 0.22).fillRoundedRect(c.x - w / 2, c.y + 6 - hgt / 2, w, hgt, 9)
      g.lineStyle(2, colour, alpha)
      if (q.far) dashedRect(g, c.x - w / 2, c.y + 6 - hgt / 2, w, hgt)
      else g.strokeRoundedRect(c.x - w / 2, c.y + 6 - hgt / 2, w, hgt, 9)
      let y = c.y + 6 - hgt / 2 + 3
      // Its tags over the units (the marks' layer, under the units' own marks, which give way to them).
      for (const t of q.tags) y += legible(this.text(c.x - w / 2 + 5, y, t.text, 9, t.color, 3).setDepth(6900).setAlpha(q.far ? 0.6 : 1), this.labelZ, 'num').displayHeight - 2
    }
    for (const a of p.arrows) {
      const from = a.from.map(posFor)
      const to = posFor(a.to)
      const fx = from.reduce((n, f) => n + f.x, 0) / from.length
      const fy = from.reduce((n, f) => n + f.y, 0) / from.length + 4
      const [dx, dy] = [to.x - fx, to.y + 6 - fy]
      const len = Math.hypot(dx, dy)
      if (len < 40) continue
      const [ux, uy] = [dx / len, dy / len]
      const [ex, ey] = [to.x - ux * 26, to.y + 6 - uy * 26]
      const [bx, by] = [ex - ux * 10, ey - uy * 10]
      const colour = hex(a.color)
      const alpha = a.far ? 0.45 : 0.9
      g.lineStyle(2.5, colour, alpha)
      if (a.far || a.held) dashed(g, fx + ux * 14, fy + uy * 14, bx, by, 6, 5)
      else g.lineBetween(fx + ux * 14, fy + uy * 14, bx, by)
      g.fillStyle(colour, alpha).fillTriangle(ex, ey, bx - uy * 6, by + ux * 6, bx + uy * 6, by - ux * 6)
      g.fillCircle(fx, fy, 3.5)
    }
  }

  drawLabels (p) {
    // Over the first lane, not the dais's margin.
    const x = -LANES / 2 * SPREAD + 4
    const y = rowY(DEPTH - 1) - 88
    legible(this.text(x, y, p.facing ? 'THEIR FORMATION' : 'THEIR GROUND', 14, p.facing ? ROSE : '#b0808e', 3, faceFor(14, this.labelZ)).setOrigin(0, 1).setDepth(-300), this.labelZ)
  }

  // Behind the camp, under the board: the held detachments' bodies by detachment (its id and start in its
  // colour), then the reserve that sits the battle out. Only drawn when any wait.
  drawWaiting (p) {
    this.waitRect = null
    const w = p.waiting
    if (!w) return
    // Under the camp; or, where the stage is wide (fit: waitSide), beside it, right of the camp's rows, so the
    // board keeps the height a short screen (a phone) has least of.
    const side = !!this.waitSide
    const left = side ? BAND / 2 + 18 : -BAND / 2 + 12
    const right = side ? left + 210 : BAND / 2 - 12
    const top = side ? rowY(CAMP_ROWS - 1) - ROW_PX / 2 + 4 : EDGE + ROW_PX / 2 + 20
    const head = legible(this.text(left, top, 'BEHIND THE CAMP', 10, '#8fb8a8').setOrigin(0, 0).setDepth(-300), this.labelZ)
    // Its heading wraps to the room it has at the zoom (kept legible, it may stand wider than that).
    head.setWordWrapWidth((right - left) / head.scaleX)
    let x = left
    let y = top + Math.max(30, head.displayHeight + 16)
    const room = (n) => { if (x + n > right) { x = left; y += 34 } }
    const body = (b, alpha) => {
      room(24)
      const img = this.add.image(x + 11, y + 12, `unit:${unitDef(b.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES * 0.36).setAlpha(alpha).setDepth(-299)
      this.layer.push(img)
      if (b.banner) {
        const ring = this.add.ellipse(x + 11, y + 13, 20, 6).setStrokeStyle(1.2, hex(b.banner), 0.8).setDepth(-300)
        this.layer.push(ring)
      }
      x += 24
    }
    const tag = (str, colour) => {
      const t = legible(this.text(0, 0, str, 9, colour, 3).setDepth(-299), this.labelZ, 'num')
      room(t.displayWidth + 6)
      t.setPosition(x, y + 6).setOrigin(0, 0.5)
      x += t.displayWidth + 6
    }
    for (const d of w.held) {
      tag(d.tag, d.color)
      for (const b of d.bodies) body(b, 0.85)
      x += 10
    }
    if (w.reserve.length) {
      tag(`${w.reserve.length} sit out`, '#8a8398')
      for (const b of w.reserve) body(b, 0.55)
    }
    this.waitRect = side ? { l: left - 6, r: right + 6, t: top - 4, b: y + 20 } : { l: -BAND / 2, r: BAND / 2, t: top - 4, b: y + 20 }
    // The room each way, measured, for the next choice between them (placeWaiting).
    if (!side) this.belowH = this.waitRect.b + 8 - (EDGE + 34)
    else this.besideW = this.waitRect.r - (BAND / 2 + 6)
  }

  // ── units ────────────────────────────────────────────────────────────────────────────────────

  addActor (u, appear) {
    const art = unitDef(u.id).art
    const home = posFor(u.tile)
    const sprite = this.add.image(home.x, home.y, `unit:${art}:alive`).setOrigin(0.5, FEET).setFlipX(u.side === 'foe')
    const scale = SCALE / RES * (u.rank ? RANK_SCALE : 1)
    const size = sprite.width / RES / 96 * (u.rank ? RANK_SCALE : 1)
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size, 13 * size, 0x000000, 0.5)
    const a = { key: u.key, sprite, shadow, scale, size, chest: 30 * size, tile: u.tile, u, parts: [], growth: null, ins: null, pop: { v: 0 }, rise: { v: appear ? 0 : 1 }, seed: Math.random() * 6 }
    if (appear && reducedMotion()) a.rise.v = 1
    else if (appear) this.tweens.add({ targets: a.rise, v: 1, duration: 320, ease: 'Sine.Out' })
    this.actors.set(u.key, a)
    return a
  }

  dropActor (a, fade) {
    this.actors.delete(a.key)
    const all = [a.sprite, a.shadow, ...a.parts.map((x) => x.o), ...(a.growth?.parts ?? []), a.ins].filter(Boolean)
    if (!fade) return all.forEach((o) => o.destroy())
    this.tweens.add({ targets: all, alpha: 0, duration: 220, onComplete: () => all.forEach((o) => o.destroy()) })
  }

  // A unit's marks, made anew from its picture entry: its bars, its rank and growth (growthMarks, as in battle),
  // its level, and what the editor marks on it (falter, bond, detachment, selection, a held start…). Each part
  // keeps an offset from the feet and a layer: 'under' the unit, 'ground' with its bars, 'mark' and 'top' over
  // everyone (a neighbour never hides a falter tag).
  dress (a) {
    for (const x of a.parts) x.o.destroy()
    for (const o of a.growth?.parts ?? []) o.destroy()
    a.ins?.destroy()
    a.parts = []
    a.growth = null
    a.ins = null
    const u = a.u
    const part = (o, dx, dy, layer, extra = {}) => { a.parts.push({ o, dx, dy, layer, ...extra }); return o }
    const txt = (str, size, colour, stroke = 3) => this.add.text(0, 0, str, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: '#07060b', strokeThickness: stroke }).setResolution(3)
    const foe = u.side === 'foe'
    a.sprite.setTexture(`unit:${unitDef(u.id).art}:${u.fallen ? 'dead' : 'alive'}`)
    if (u.fallen) a.sprite.setTint(0xc4bfd0)
    else a.sprite.clearTint()
    a.ghost = u.ghost ?? 1
    // Under the feet: the selection, a pick, the led, the domain's centre (Vanguard Crown), a sealing Monarch.
    const ring = (w, colour, alpha, line = 2) => part(this.add.ellipse(0, 0, w * a.size, w * 0.3 * a.size).setStrokeStyle(line, colour, alpha), 0, 4, 'under')
    const glow = (w, colour, alpha) => part(this.add.image(0, 0, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(w * a.size, w * 0.32 * a.size).setAlpha(alpha), 0, 4, 'under')
    if (u.centre) { glow(96, GOLD, 0.45); ring(70, GOLD, 0.7, 1.5) }
    if (u.seal) ring(74, FOE, 0.75, 1.5)
    if (u.led) ring(60, SOUL, 0.5, 1.5)
    if (u.pick) { glow(90, hex(C.orders), 0.4); ring(66, hex(C.orders), 0.95, 2.5) }
    // The selected soul, found at a glance while its card is open: a bright pulsing ring in a pool of light, a
    // ripple spreading from it (update), and a bobbing chevron over its head (placed first: layoutMarks).
    if (u.sel) {
      glow(124, SOUL, 0.75).setData('pulse', true)
      ring(72, SOUL, 1, 4).setData('pulse', true)
      ring(72, SOUL, 0.9, 2.5).setData('ripple', true)
      // About twice a number's height on screen however far out the board is (its 'size' as if 6 tall).
      const chev = this.add.graphics()
      chev.fillStyle(SOUL, 0.35).fillCircle(0, -6, 11)
      chev.fillStyle(SOUL, 1).fillTriangle(-9, -11, 9, -11, 0, 0)
      chev.lineStyle(2, 0x07060b, 0.95).strokeTriangle(-9, -11, 9, -11, 0, 0)
      part(legible(chev.setData('size', 6), this.labelZ, 'num'), 0, -a.chest * 2.95 - 4, 'top', { move: 0, bob: true, box: [-11, -17, 11, 5] })
    }
    // A soul of a detachment stands in a faint ring of its colour, as in battle.
    if (u.det && !u.det.dot) part(this.add.ellipse(0, 0, 50 * a.size, 15 * a.size).setStrokeStyle(1.5, hex(u.det.color), 0.6), 0, 4, 'under', { keep: true })
    // The bars: the Monarch's thicker, in its gold frame.
    const crowned = !!u.monarch
    const colour = foe ? FOE : PARTY
    part(this.add.rectangle(0, 0, BAR + 2, crowned ? 12 : 10, 0x07060b, 0.92).setStrokeStyle(1, crowned ? CROWN : 0x2c2740), 0, BAR_DROP + 2, 'ground', { keep: true })
    const f = u.maxHp ? Math.max(0, u.hp / u.maxHp) : 1
    if (f > 0) part(this.add.rectangle(0, 0, BAR * f, crowned ? 6 : 4, colour).setOrigin(0, 0.5), -BAR / 2, BAR_DROP, 'ground', { z: 0.2, keep: true })
    // Every mark that carries print is kept legible at the board's zoom (engine.js legible: a number as the
    // page's --fs-xs at the frame's scale), and placed by the size it then has.
    const z = this.labelZ
    const L = (o, size, kind = 'num') => legible(o.setData('size', size), z, kind)
    // The marks that carry print stand round the unit, each where it belongs (`move`: the order layoutMarks
    // places them in, nudging each clear of every mark placed before it, its neighbours' too, and of the
    // domain's caption). Left of the feet: its level (yours: the tray is where it grows; the Monarch's points
    // once it has any), ringed in its rank's metal and wearing a Knight's or Marshal's insignia as tall as its
    // number; over it, a melee blocked behind melee (⇈). Right of the feet: a bond's ◆, a member's detachment
    // dot. Over its head: a soul's detachment tag.
    const grade = u.grade ?? 0
    // (A body of a banner wears none: every body fights at the muster's level, told on its card and in Bones.)
    if (!foe && !u.rank && (!crowned || u.lvl > 0)) {
      const metal = crowned ? CROWN : grade >= 2 ? hex(C.marshal) : grade === 1 ? hex(C.knight) : 0x5a5078
      const kids = [this.add.circle(0, 0, 9.5, 0x07060b, 0.92).setStrokeStyle(grade && !crowned ? 2.2 : 1.5, metal),
        txt(String(u.lvl), 11, crowned ? C.monarch : '#e6def4', 0).setOrigin(0.5)]
      const ins = !crowned && grade > 0
      if (ins) kids.push(insignia(this, grade, u.banner ? hex(u.banner) : MARSHAL).setScale(0.95).setPosition(11, -9))
      const pill = L(this.add.container(0, 0, kids), 11)
      part(pill, -MARK_X, -7, 'mark', { z: 0.3, move: 1, box: [-10, ins ? -19 : -10, ins ? 21 : 10, 10] })
    }
    if (u.behind) part(L(txt('⇈', 14, C.foe).setOrigin(0.5, 1), 14), -MARK_X, -18, 'mark', { move: 3 })
    // Right of the bars, as in battle: the falter tag (×0.7), only on the unit in focus (selected, under the
    // pointer, dragged: update); every faltering unit's ground is hatched red (falterGround).
    if (u.falters) {
      part(falterGround(this, a.size), 0, 4, 'under', { z: 0.05, falter: true, keep: true })
      // On a dark plate: shown over a crowd, it reads over whatever it must cover.
      const tag = txt(`×${TUNING.monarch.falter}`, 10, C.foe).setOrigin(0, 0.5).setBackgroundColor('#1a0a10e6').setPadding(3, 1, 3, 1)
      part(L(tag, 10), BAR / 2 + 3, BAR_DROP + 2, 'top', { falter: true, tag: true, move: 9 })
    }
    const bond = u.bonded && L(txt('◆', 13, foe ? ROSE : C.synergy).setOrigin(0.5), 13)
    if (bond) part(bond, MARK_X, -4, 'mark', { move: 4 })
    if (u.det?.dot) part(this.add.circle(0, 0, 4, hex(u.det.color)).setStrokeStyle(1.5, 0x07060b), MARK_X, -14, 'mark', { move: 5, box: [-5, -5, 5, 5] })
    else if (u.det) {
      // Over its head, and over a captain's flag (which grows from the shoulder as its count is kept legible):
      // its id and where, short (a held soul stands ghosted; when it enters is on its square, behind the camp
      // and on hover).
      const t = txt(`${u.det.id}${WHERE[u.det.where]}`, 10, u.det.color, 0).setOrigin(0.5)
      const plate = this.add.rectangle(0, 0, t.width + 10, 15, 0x07060b, 0.85).setStrokeStyle(1, hex(u.det.color), 0.8)
      const tag = L(this.add.container(0, 0, [plate, t]), 10)
      const flag = !u.rank && !u.monarch && (u.count ?? 0) > 0 ? 24 * labelScale(15, z, 'num') + 4 : 0
      part(tag, 0, -Math.max(a.chest * 2.95, a.chest * 2.1 + flag + 7.5 * tag.scaleY), 'top', { move: 2, box: [-(t.width + 10) / 2, -7.5, (t.width + 10) / 2, 7.5] })
    }
    // A rank-and-file standing on a fallen soul's cell: a small ghost beside it, edged in its banner's colour.
    if (u.under) {
      const g = this.add.image(0, 0, `unit:${unitDef(u.under.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES * 0.45).setAlpha(0.75)
      part(g, 24, -2, 'ground', { z: 0.25 })
      if (u.under.colour) part(this.add.ellipse(0, 0, 26, 8).setStrokeStyle(1.2, hex(u.under.colour), 0.9), 24, 0, 'ground', { z: 0.24 })
      // Led by the selected captain, as a member on its own cell is.
      if (u.under.led) part(this.add.ellipse(0, 0, 32, 10).setStrokeStyle(1.5, SOUL, 0.6), 24, 1, 'ground', { z: 0.23 })
    }
    // A foe captain's flag, with the size of its cohort.
    if (foe && u.count) {
      const fl = this.add.graphics()
      fl.lineStyle(1.5, 0xd8c8b8, 0.9).lineBetween(0, 3, 0, -17)
      fl.fillStyle(FOE, 1).fillRect(0.8, -17, 17, 12)
      part(L(this.add.container(0, 0, [fl, txt(String(u.count), 11, '#07060b', 0).setOrigin(0.5).setPosition(9.3, -11)]), 11), -BAR / 2 - 8, BAR_DROP + 2, 'ground', { z: 0.3 })
    }
    // Yours wear their growth as in battle (a captain's flag kept legible); a Knight's or a Marshal's insignia
    // is on its level's pill (above).
    if (!foe && !u.rank && !u.monarch) {
      a.growth = growthMarks(this, u, { banner: u.banner, count: u.count ?? 0, size: a.size })
      a.growth.legible(z)
    }
    // A member edged in its banner's colour.
    if (u.rank && u.banner) part(this.add.ellipse(0, 0, 44 * a.size, 13 * a.size).setStrokeStyle(1.5, hex(u.banner), 0.7), 0, 4, 'under', { z: 0.1 })
  }

  // A unit's body as drawn at its tile (its picture's middle, from its head down to its bars), in world px.
  bodyOf (a, at = posFor(a.tile)) {
    const s = a.sprite
    const w = s.displayWidth * 0.3
    return { l: at.x - w, r: at.x + w, t: at.y - s.displayHeight * FEET * 0.92, b: at.y + BAR_DROP + 6 }
  }

  // The marks that carry print, laid out together so none covers another: the selected soul's first, then
  // front to back, each mark (by its `move`) nudged the least way (up first, a little sideways, staying in its
  // lane where it can) clear of every one placed before it: its own unit's, its neighbours', the captains'
  // flags, the plans' tags, the board's labels and the domain's caption (placed first, outside its box).
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
    // The falter tags last (a second pass): each shows on one unit at a time, so it gives way to every other.
    for (const tags of [false, true]) for (const a of units) {
      const home = posFor(a.tile)
      const lane = tags ? { l: -Infinity, r: Infinity } : { l: home.x - SPREAD / 2 + 2, r: home.x + SPREAD / 2 - 2 }
      for (const x of a.parts.filter((p) => p.move != null && !!p.tag === tags).sort((p, q) => p.move - q.move)) {
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
          const cost = placed.reduce((n, p) => n + overlap(r, p), 0) + out * (r.b - r.t) * 0.25
          if (!best || cost < best.cost - 0.01) best = { cost, ox, oy, r }
          if (cost === 0) break
        }
        x.dx = x.bx + best.ox
        x.dy = x.by + best.oy
        // The falter tag shows on one unit at a time: nobody gives way to it.
        if (!x.tag) placed.push(best.r)
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
    // Asleep while its editor is off screen (the map's Route tab, the spoils, a rite): the next show wakes it.
    if (!this.leaving && !want?.stage.isConnected) return this.rest()
    const v = reducedMotion() ? 0.8 : this.beat.v // the selection and an open approach pulse; held still if reduced
    // While dragging: the lifted soul hides off the board (the editor's ghost carries it over the page), a soul
    // the drop would displace dims, and where the preview tells the falters (follow) its tags stand for all.
    const drag = this.drag
    const seen = (a) => a.lifted && drag?.off ? 0 : drag?.preview?.swap?.key === a.key ? 0.35 : 1
    const told = !!drag?.preview?.falter
    for (const a of this.actors.values()) {
      const s = a.sprite
      const breath = a.u.fallen || reducedMotion() ? 0 : BREATH * Math.sin(time / 640 + a.seed)
      const pop = a.pop.v
      s.setScale(a.scale * (1 + 0.14 * pop) * (0.6 + 0.4 * a.rise.v), a.scale * (1 + breath + 0.2 * pop) * (0.6 + 0.4 * a.rise.v))
      s.setDepth(a.lifted ? 9500 + s.y : s.y)
      s.setAlpha((a.lifted ? 0.92 : a.ghost) * a.rise.v * seen(a))
      const ground = a.lifted ? a.drop : { x: s.x, y: s.y }
      a.shadow.setPosition(ground.x, ground.y + 4).setDepth(ground.y - 2).setAlpha(0.5 * a.rise.v * seen(a))
      // The unit in focus (selected, under the pointer) tells its falter in a tag; the rest only by the ground.
      const focus = a.u.sel || (!drag && this.hovered === a.tile)
      for (const x of a.parts) {
        const depth = x.layer === 'under' ? s.y - 1.4 + (x.z ?? 0) : x.layer === 'top' ? 8000 + s.y : x.layer === 'mark' ? 7000 + s.y : s.y + 0.5 + (x.z ?? 0.1)
        const bob = x.bob && !reducedMotion() ? 3 * Math.sin(time / 260) : 0
        x.o.setPosition(s.x + x.dx, s.y + x.dy + bob).setDepth(a.lifted ? depth + 9500 : depth)
        const hide = (a.lifted && (x.layer === 'top' || x.layer === 'under' || x.falter)) || (x.falter && told) || (x.tag && !focus)
        let alpha = x.o.getData?.('pulse') ? 0.55 + 0.45 * v : 1
        // The selection's ripple spreads and fades, once a second (still under reduced motion: none).
        if (x.o.getData?.('ripple')) {
          const t = (time % 1100) / 1100
          x.o.setScale(1 + 0.7 * t)
          alpha = reducedMotion() ? 0 : 0.9 * (1 - t)
        }
        x.o.setAlpha(hide ? 0 : alpha * a.rise.v * (x.layer === 'ground' && a.ghost < 1 ? 0.8 : 1) * seen(a))
      }
      a.growth?.place(s.x, s.y, s.depth, a.chest, 0)
      a.ins?.setPosition(s.x - a.chest * 0.75, s.y - a.chest * 2.3).setDepth(s.depth + 0.05)
      for (const o of [a.ins, ...(a.growth?.parts ?? [])]) o?.setVisible(seen(a) > 0)
    }
    this.glowG.setAlpha(0.55 + 0.45 * v)
    this.live(v)
    this.easing(time)
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

  // Redrawn every frame: the approach tiles beside the Monarch (an open one pulsing red), the tile under the
  // pointer (a crosshair while a detachment aims), and while dragging the drop tile, green or red.
  live (v) {
    const g = this.liveG.clear()
    const p = this.picture
    if (!p || this.leaving) return
    // A dragged Monarch carries its approach with it (the preview's, where it would stand).
    for (const t of this.drag?.preview?.approach ?? p.approach) {
      const { x, y } = posFor(t.tile)
      if (t.bare) {
        g.fillStyle(FOE, 0.05 + 0.08 * v).fillEllipse(x, y + 6, 60, 19)
        g.lineStyle(2, FOE, 0.3 + 0.5 * v).strokeEllipse(x, y + 6, 60, 19)
      } else g.lineStyle(1.2, FOE, 0.3).strokeEllipse(x, y + 6, 58, 18)
    }
    // The keyboard's tile: a bright frame, apart from the pointer's ring.
    if (this.focused != null && !this.drag) {
      const { x, y } = posFor(this.focused)
      g.lineStyle(2, 0xffffff, 0.6 + 0.35 * v).strokeRoundedRect(x - SPREAD / 2 + 5, y + 6 - ROW_PX / 2 + 5, SPREAD - 10, ROW_PX - 10, 8)
    }
    const d = this.drag
    const at = d ? d.preview?.tile : typeof this.hovered === 'number' ? this.hovered : null
    if (at == null) return
    const { x, y } = posFor(at)
    if (d) {
      const ok = d.preview.ok
      g.fillStyle(ok ? SOUL : FOE, 0.12).fillEllipse(x, y + 6, 66, 21)
      g.lineStyle(2.5, ok ? SOUL : FOE, 0.95).strokeEllipse(x, y + 6, 66, 21)
    } else if (p.aim) {
      g.lineStyle(2, SOUL, 0.95).strokeEllipse(x, y + 6, 60, 19)
      g.lineStyle(1.5, SOUL, 0.8).lineBetween(x - 36, y + 6, x - 22, y + 6).lineBetween(x + 22, y + 6, x + 36, y + 6)
        .lineBetween(x, y - 10, x, y - 3).lineBetween(x, y + 15, x, y + 22)
    } else g.lineStyle(1.5, 0xffffff, 0.55).strokeEllipse(x, y + 6, 58, 18)
  }

  // A pop of soulfire on a unit that just grew (a level, a tier, a rank, a cohort): it swells and sparks. Under
  // reduced motion it does not: the tray's card says what grew.
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
  // camp for the bars and the bodies waiting behind it.
  bounds () {
    const wr = this.waitRect
    return {
      l: -BAND / 2 - 6,
      r: wr && this.waitSide ? Math.max(BAND / 2 + 6, wr.r) : BAND / 2 + 6,
      t: rowY(DEPTH - 1) - ROW_PX / 2 - TOP,
      b: wr && !this.waitSide ? wr.b + 8 : EDGE + 34
    }
  }

  // Whether the bodies waiting behind the camp go beside it (true) or under it: whichever leaves the board
  // bigger in a stage of r's shape (the other layout's box estimated: beside, 240 wide; under, as tall as it
  // last was). A change redraws, and the board is fitted again.
  placeWaiting (r, b) {
    if (!this.picture?.waiting) return false
    const side = !!this.waitSide
    const below = side ? { ...b, r: BAND / 2 + 6, b: EDGE + 34 + (this.belowH ?? 110) } : b
    const beside = side ? b : { ...b, r: BAND / 2 + 6 + (this.besideW ?? 240), b: EDGE + 34 }
    const zoomIn = (x) => Math.min(r.width / (x.r - x.l), r.height / (x.b - x.t))
    const next = zoomIn(beside) > zoomIn(below) * 1.04
    // At most one change a moment: two layouts that each estimate the other better never flicker.
    if (next === side || this.time.now - (this.waitFlip ?? -1e9) < 600) return false
    this.waitFlip = this.time.now
    this.waitSide = next
    this.draw(this.picture)
    return true
  }

  // Fits the board inside the stage's rect (in the viewport, so a scroll or a resize carries it along), clear
  // of the `avoid` elements laid over the stage (the waves still to come, the legend): see around. Checked
  // every frame; it only moves when something did.
  fit () {
    const w = want
    // A drag's eased-in view holds until the camera is back on the board's own (dragView).
    if (!w?.stage.isConnected || this.leaving || this.camAnim || this.drag?.zoomed) return
    const r = w.stage.getBoundingClientRect()
    const c = this.game.canvas.getBoundingClientRect()
    const els = w.avoid.filter((e) => e.isConnected)
    const b = this.bounds()
    const cam = this.cameras.main
    const keyOf = () => [r.left, r.top, r.width, r.height, c.left, c.top, c.width, c.height, b.b,
      ...els.flatMap((e) => { const a = e.getBoundingClientRect(); return [a.left, a.top, a.right, a.bottom] })].join()
    if (!r.width || !r.height || keyOf() === this.fitKey) return
    if (this.placeWaiting(r, b)) return
    // v: the zoom, and a world point (wx, wy) with the viewport point it shows at (sx, sy). The floor fills the
    // page around it.
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
    // A new zoom: the labels laid out by their size (the Move squares', the bodies behind the camp) are laid
    // out again at it, and the board fitted again (the bodies behind the camp may take more room); a small
    // change only rescales them.
    if (this.picture && (was == null || Math.abs(v.z / was - 1) > 0.02)) {
      this.draw(this.picture)
      this.fitKey = ''
    } else {
      for (const t of [...this.layer, this.domLabel]) if (t?.getData?.('legible')) legible(t, v.z)
      for (const a of this.actors.values()) {
        for (const x of a.parts) if (x.o.getData?.('legible')) legible(x.o, v.z)
        a.growth?.legible(v.z)
      }
      this.layoutMarks()
    }
  }

  // A drag by touch on a board whose tiles stand under DRAG.zoomUnder CSS px (a phone's): the view it eases in
  // to, your camp and the open ground with their front row's feet as large as the stage holds (at most 1.8×),
  // the point under the finger (fx, fy) kept under it as far as the camp still fits the stage. Null when that
  // would hardly zoom.
  dragView (fx, fy) {
    const f = this.fitted
    if (!f || !want?.stage.isConnected || ROW_PX * f.z >= DRAG.zoomUnder) return null
    const r = want.stage.getBoundingClientRect()
    const box = { l: -BAND / 2 - 6, r: BAND / 2 + 6, t: rowY(CAMP_ROWS + 1) - 30, b: EDGE + 34 }
    const z = Math.min(r.height / (box.b - box.t), r.width / (box.r - box.l), f.z * 1.8)
    if (z < f.z * 1.08) return null
    const p = this.toWorld(fx, fy)
    let mx = p.x - (fx - f.ox - f.w / 2) / z
    let my = p.y - (fy - f.oy - f.h / 2) / z
    // Each way, the camp's box onto the stage (centred where it is the larger).
    const keep = (lo, hi, m, half, o, a, b) => {
      const [s0, s1] = [o + (lo - m) * z + half, o + (hi - m) * z + half]
      if (s1 - s0 > b - a) return (lo + hi) / 2 - ((a + b) / 2 - o - half) / z
      return s0 < a ? m - (a - s0) / z : s1 > b ? m + (s1 - b) / z : m
    }
    mx = keep(box.l, box.r, mx, f.w / 2, f.ox, r.left, r.right)
    my = keep(box.t, box.b, my, f.h / 2, f.oy, r.top, r.bottom)
    return { ...f, z, mx, my }
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

  // Each frame while the camera eases (update): the view between, and the lifted soul kept under the finger.
  easing (time) {
    const a = this.camAnim
    if (!a) return
    const t = a.ms ? Math.min(1, (time - a.t0) / a.ms) : 1
    const e = t * t * (3 - 2 * t)
    const lerp = (k) => a.from[k] + (a.to[k] - a.from[k]) * e
    this.applyView({ ...a.to, z: a.from.z * Math.pow(a.to.z / a.from.z, e), mx: lerp('mx'), my: lerp('my') })
    if (this.drag?.fx != null) this.follow(this.drag.fx, this.drag.fy)
    if (t < 1) return
    this.camAnim = null
    if (a.back) this.fitKey = ''
  }

  // Back to the board's own view at once (a handoff, a rest).
  unzoom () {
    this.camAnim = null
    if (this.fitted && this.view !== this.fitted) this.applyView(this.fitted)
  }

  // The biggest board the stage holds clear of the overlays: each overlay it would cover is cleared either
  // beside the board (a column off that side) or over it (a band off the top), every way tried; an overlay with
  // forms (data-forms: the legend, a column or a row of chips) is tried in each, and left in the best.
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
    const stage = solve({ l: r.left, r: r.right, t: r.top, b: r.bottom })
    const forms = els.map((e) => e.dataset.forms?.split(' ') ?? [e.dataset.form])
    let best = null
    const each = (i, picked) => {
      if (i === els.length) {
        const v = clear(stage, els.map((e) => e.getBoundingClientRect()).filter((a) => a.width && a.height))
        if (!best || v.z > best.v.z + 1e-3) best = { v, picked }
        return
      }
      for (const f of forms[i]) {
        if (f != null) els[i].dataset.form = f
        each(i + 1, [...picked, f])
      }
    }
    each(0, [])
    best.picked.forEach((f, i) => { if (f != null) els[i].dataset.form = f })
    const v = best.v
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
  // a soul is dragged by touch the drop goes by its feet, drawn DRAG.lift above the finger (follow).
  tileAt (x, y) {
    if (!this.view) return null
    const feet = !!this.drag?.touch
    const p = this.toWorld(x, feet ? y - DRAG.lift : y)
    const wr = this.waitRect
    if (wr && p.x >= wr.l && p.x <= wr.r && p.y >= wr.t && p.y <= wr.b) return 'reserve'
    if (!this.drag) {
      // By touch with nothing selected (a press can only pick), a press just off a body (TOUCH_SLOP CSS px)
      // picks it too.
      const slop = pointerType !== 'touch' || this.picture?.selKey || this.picture?.aim ? 0 : TOUCH_SLOP / this.view.z
      let best = null
      for (const a of this.actors.values()) {
        if (a.rise.v < 1 || a.sprite.alpha < 0.05) continue
        const b = this.bodyOf(a, { x: a.sprite.x, y: a.sprite.y })
        const d = Math.hypot(Math.max(0, b.l - p.x, p.x - b.r), Math.max(0, b.t - p.y, p.y - b.b))
        if (d > slop) continue
        // Inside a body beats beside one; among those inside, the front-most (drawn over the rest).
        const rank = d > 0 ? -d : 1e4 + a.sprite.y
        if (!best || rank > best.rank) best = { a, rank }
      }
      if (best) return best.a.tile
    }
    if (Math.abs(p.x) > LANES / 2 * SPREAD) return null
    const tx = Math.round(p.x / SPREAD + (LANES - 1) / 2)
    let ty = Math.round((DEPTH - 1) / 2 - (p.y + (feet ? -6 : HIT_UP)) / ROW_PX)
    // The rear row's bars, and their back row's heads, still count as theirs.
    if (ty === -1 && p.y <= EDGE + 30) ty = 0
    if (ty === DEPTH && p.y >= -EDGE - 96) ty = DEPTH - 1
    return ty >= 0 && ty < DEPTH ? tileOf(tx, ty) : null
  }

  rectOf (tile) {
    if (!this.view) return null
    const p = tile === 'reserve' ? null : posFor(tile)
    const box = p ? { l: p.x - SPREAD / 2, t: p.y - HIT_UP - ROW_PX / 2, r: p.x + SPREAD / 2, b: p.y - HIT_UP + ROW_PX / 2 } : this.waitRect
    if (!box) return null
    const a = this.toScreen(box.l, box.t)
    const z = this.toScreen(box.r, box.b)
    return { left: a.x, top: a.y, right: z.x, bottom: z.y }
  }

  // ── dragging ─────────────────────────────────────────────────────────────────────────────────

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
    this.drag = { key: a ? what : null, a, sprite, ghost, chest: a?.chest ?? 30, preview: null, touch: pointerType === 'touch' }
    // By touch on a small board the camera eases in on the camp for the drag (dragView), back out on the drop.
    const v = this.drag.touch && this.dragView(x, y)
    if (v) {
      this.drag.zoomed = true
      this.easeTo(v)
    }
    this.follow(x, y, null)
  }

  // The lifted soul follows the pointer (its feet under it); a new `preview` ({ tile, ok, centre, falter,
  // approach, swap }) moves the domain to where it would centre, the dragged Marshal's own with it, and the
  // approach with a dragged Monarch; tags with ×0.7 every tile whose body would falter (all of them: the
  // standing tags give way to these), and shows a soul it would displace, ghosted on the tile it would go to.
  // A refused drop's preview tells none of it (falter null): the board stays as it stands.
  follow (x, y, preview, off = this.drag?.off) {
    const d = this.drag
    if (!d || !this.view) return
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
    this.swapGhost?.destroy()
    this.swapGhost = null
    const sw = preview?.swap
    if (sw?.to != null) {
      const c = posFor(sw.to)
      this.swapGhost = this.add.image(c.x, c.y, `unit:${unitDef(sw.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES)
        .setAlpha(0.5).setTint(SOUL).setDepth(c.y)
    }
    const g = this.overG.clear()
    for (const t of this.overText) t.destroy()
    this.overText = []
    // Every tile whose body would falter, its ground hatched red (the standing ones give way to these); the
    // number only where the dragged soul itself would stand.
    for (const tile of preview?.falter ?? []) {
      const c = posFor(tile)
      this.overText.push(falterGround(this).setPosition(c.x, c.y + 4).setDepth(c.y - 1.3))
      if (tile !== preview.tile) continue
      const t = legible(this.add.text(c.x + BAR / 2 + 3, c.y + BAR_DROP + 2, `×${TUNING.monarch.falter}`, { fontFamily: FONT, fontSize: '10px', fontStyle: 'bold', color: C.foe, stroke: '#07060b', strokeThickness: 3 })
        .setResolution(3).setOrigin(0, 0.5).setDepth(9610), this.labelZ, 'num')
      const [tw, th] = [t.displayWidth, t.displayHeight]
      g.fillStyle(0x2a1018, 0.9).fillRoundedRect(t.x - 3, t.y - th / 2 - 1, tw + 6, th + 2, 4)
      g.lineStyle(1, FOE, 0.8).strokeRoundedRect(t.x - 3, t.y - th / 2 - 1, tw + 6, th + 2, 4)
      this.overText.push(t)
    }
  }

  dropped () {
    const d = this.drag
    if (!d) return
    this.drag = null
    d.ghost?.destroy()
    this.swapGhost?.destroy()
    this.swapGhost = null
    if (d.a) {
      d.a.lifted = false
      const home = posFor(d.a.tile)
      this.tweens.add({ targets: d.a.sprite, x: home.x, y: home.y, duration: 200, ease: 'Sine.Out' })
    }
    this.overG.clear()
    for (const t of this.overText) t.destroy()
    this.overText = []
    if (this.picture) this.drawDomain(this.picture.domain?.centre ?? null)
    // An eased-in drag's camera eases back to the board's own view.
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
    // What the battle draws too (the bars, a falter tag, a detachment's ring, the growth) stays; the rest fades.
    const marks = [this.planG, this.domG, this.liveG, this.domLabel, ...this.layer,
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

// Whether a unit grew between two pictures: a level, a tier, a rank, its cohort, its HP.
const grew = (a, b) => a.lvl !== b.lvl || a.tier !== b.tier || a.tier2 !== b.tier2 || a.grade !== b.grade || a.count !== b.count || a.maxHp !== b.maxHp

// A dashed line, and a dashed box, for what is not yet so: a one-way trip, a Marshal's reach.
function dashed (g, x1, y1, x2, y2, dash = 7, gap = 5) {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len]
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash)
    g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e)
  }
}

function dashedRect (g, x, y, w, h) {
  dashed(g, x, y, x + w, y)
  dashed(g, x + w, y, x + w, y + h)
  dashed(g, x + w, y + h, x, y + h)
  dashed(g, x, y + h, x, y)
}
