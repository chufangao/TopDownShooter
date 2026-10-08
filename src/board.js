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
  PARTY, FOE, SOUL, GOLD, CROWN, MARSHAL, DOMAIN, NEUTRAL, C, FONT, SERIF, hex, insignia, growthMarks, palette, reducedMotion, legible
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

  create () {
    palette()
    scene = this
    starting = false
    this.actors = new Map() // key → { sprite, shadow, scale, chest, tile, u, parts, growth, mark, pop, lifted }
    this.layer = []         // the picture's texts and glows, made anew on every draw
    this.picture = null
    this.view = null        // the camera's mapping (see fit)
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
      this.domLabel = this.add.text(left + 8, top + 4, d.crowned ? `DOMAIN · ${r} · VANGUARD CROWN` : `DOMAIN · ${r}`,
        { fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: d.crowned ? C.monarch : C.domain }).setResolution(3)
        // Over the units: under Vanguard Crown its corner may lie in their formation, behind their bodies.
        .setStroke('#07060b', 3).setDepth(7900)
      legible(this.domLabel, this.view?.z)
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
      const t = this.add.text(LANES / 2 * SPREAD + 4, y, 'LINE', { fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: C.soul2, stroke: '#07060b', strokeThickness: 3 })
        .setResolution(3).setOrigin(0, 0.5).setDepth(-390)
      this.layer.push(legible(t, this.view?.z))
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
      for (const t of q.tags) y += legible(this.text(c.x - w / 2 + 5, y, t.text, 9, t.color, 3).setDepth(-384).setAlpha(q.far ? 0.6 : 1), this.view?.z).displayHeight - 2
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
    legible(this.text(x, y, p.facing ? 'THEIR FORMATION' : 'THEIR GROUND', 14, p.facing ? ROSE : '#b0808e', 3, SERIF).setOrigin(0, 1).setDepth(-300), this.view?.z)
  }

  // Behind the camp, under the board: the held detachments' bodies by detachment (its id and start in its
  // colour), then the reserve that sits the battle out. Only drawn when any wait.
  drawWaiting (p) {
    this.waitRect = null
    const w = p.waiting
    if (!w) return
    const left = -BAND / 2 + 12
    const right = BAND / 2 - 12
    const top = EDGE + ROW_PX / 2 + 20
    const head = legible(this.text(left, top, 'BEHIND THE CAMP', 10, '#8fb8a8').setOrigin(0, 0).setDepth(-300), this.view?.z)
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
      const t = legible(this.text(0, 0, str, 9, colour, 3).setDepth(-299), this.view?.z)
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
    this.waitRect = { l: -BAND / 2, r: BAND / 2, t: top - 4, b: y + 20 }
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
    if (u.sel) { glow(100, SOUL, 0.5).setData('pulse', true); ring(68, SOUL, 0.95, 2.5).setData('pulse', true) }
    // A soul of a detachment stands in a faint ring of its colour, as in battle.
    if (u.det && !u.det.dot) part(this.add.ellipse(0, 0, 50 * a.size, 15 * a.size).setStrokeStyle(1.5, hex(u.det.color), 0.6), 0, 4, 'under', { keep: true })
    // The bars: the Monarch's thicker, in its gold frame.
    const crowned = !!u.monarch
    const colour = foe ? FOE : PARTY
    part(this.add.rectangle(0, 0, BAR + 2, crowned ? 12 : 10, 0x07060b, 0.92).setStrokeStyle(1, crowned ? CROWN : 0x2c2740), 0, BAR_DROP + 2, 'ground', { keep: true })
    const f = u.maxHp ? Math.max(0, u.hp / u.maxHp) : 1
    if (f > 0) part(this.add.rectangle(0, 0, BAR * f, crowned ? 6 : 4, colour).setOrigin(0, 0.5), -BAR / 2, BAR_DROP, 'ground', { z: 0.2, keep: true })
    // The marks round the feet keep to the unit's own lane (MARK_X either side of the centre), clear of its
    // neighbours': only the falter tag, right of the bars as in battle, reaches past it, at the bars' height,
    // where the next lane has none. Left of the feet: its level (yours: the tray is where it grows; the
    // Monarch's points once it has any), and over it a melee blocked behind melee (⇈).
    if (!foe && (!crowned || u.lvl > 0)) {
      const pill = this.add.container(0, 0, [this.add.circle(0, 0, 9.5, 0x07060b, 0.92).setStrokeStyle(1.5, crowned ? CROWN : 0x5a5078),
        txt(String(u.lvl), 11, crowned ? C.monarch : '#e6def4', 0).setOrigin(0.5)])
      part(pill, -MARK_X, -4, 'mark', { z: 0.3 })
    }
    if (u.behind) part(txt('⇈', 14, C.foe).setOrigin(0.5), -MARK_X, -23, 'mark')
    // Right of the bars: the falter tag (×0.7), as in battle. Right of the feet: a bond's ◆, and a member's
    // detachment, a dot in its colour (a soul's is its tag over its head: id, ■ Stay, → Move, a held start).
    if (u.falters) part(txt(`×${TUNING.monarch.falter}`, 10, C.foe).setOrigin(0, 0.5), BAR / 2 + 3, BAR_DROP + 2, 'mark', { falter: true, keep: true })
    if (u.bonded) part(txt('◆', 13, foe ? ROSE : C.synergy).setOrigin(0.5), MARK_X, -2, 'mark')
    if (u.det?.dot) part(this.add.circle(0, 0, 4, hex(u.det.color)).setStrokeStyle(1.5, 0x07060b), MARK_X, u.bonded ? -17 : -2, 'mark')
    else if (u.det) {
      const t = txt(`${u.det.id}${WHERE[u.det.where]}${u.det.start ? ` · ${capsTag(u.det.start)}` : ''}`, 10, u.det.color, 0).setOrigin(0.5)
      const plate = this.add.rectangle(0, 0, t.width + 10, 15, 0x07060b, 0.85).setStrokeStyle(1, hex(u.det.color), 0.8)
      part(this.add.container(0, 0, [plate, t]), 0, -a.chest * 2.95, 'top')
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
      part(this.add.container(0, 0, [fl, txt(String(u.count), 11, '#07060b', 0).setOrigin(0.5).setPosition(9.3, -11)]), -BAR / 2 - 8, BAR_DROP + 2, 'ground', { z: 0.3 })
    }
    // Yours wear their growth as in battle; a Knight or a Marshal its insignia.
    if (!foe && !u.rank && !u.monarch) a.growth = growthMarks(this, u, { banner: u.banner, count: u.count ?? 0, size: a.size })
    if (!foe && u.grade > 0) a.ins = insignia(this, u.grade, u.banner ? hex(u.banner) : MARSHAL)
    // A member edged in its banner's colour.
    if (u.rank && u.banner) part(this.add.ellipse(0, 0, 44 * a.size, 13 * a.size).setStrokeStyle(1.5, hex(u.banner), 0.7), 0, 4, 'under', { z: 0.1 })
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
      for (const x of a.parts) {
        const depth = x.layer === 'under' ? s.y - 1.4 + (x.z ?? 0) : x.layer === 'top' ? 8000 + s.y : x.layer === 'mark' ? 7000 + s.y : s.y + 0.5 + (x.z ?? 0.1)
        x.o.setPosition(s.x + x.dx, s.y + x.dy).setDepth(a.lifted ? depth + 9500 : depth)
        const hide = (a.lifted && (x.layer === 'top' || x.layer === 'under' || x.falter)) || (x.falter && told)
        x.o.setAlpha(hide ? 0 : (x.o.getData?.('pulse') ? 0.55 + 0.45 * v : 1) * a.rise.v * (x.layer === 'ground' && a.ghost < 1 ? 0.8 : 1) * seen(a))
      }
      a.growth?.place(s.x, s.y, s.depth, a.chest, 0)
      a.ins?.setPosition(s.x - a.chest * 0.75, s.y - a.chest * 2.3).setDepth(s.depth + 0.05)
      for (const o of [a.ins, ...(a.growth?.parts ?? [])]) o?.setVisible(seen(a) > 0)
    }
    this.glowG.setAlpha(0.55 + 0.45 * v)
    this.live(v)
    this.fit()
    this.glide()
  }

  // Off screen: let go of a drag and the hover, and sleep (no update, no render) until board.show wakes it.
  rest () {
    this.dropped()
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
    return {
      l: -BAND / 2 - 6,
      r: BAND / 2 + 6,
      t: rowY(DEPTH - 1) - ROW_PX / 2 - TOP,
      b: this.waitRect ? this.waitRect.b + 8 : EDGE + 34
    }
  }

  // Fits the board inside the stage's rect (in the viewport, so a scroll or a resize carries it along), clear
  // of the `avoid` elements laid over the stage (the waves still to come, the legend): see around. Checked
  // every frame; it only moves when something did.
  fit () {
    const w = want
    if (!w?.stage.isConnected || this.leaving) return
    const r = w.stage.getBoundingClientRect()
    const c = this.game.canvas.getBoundingClientRect()
    const els = w.avoid.filter((e) => e.isConnected)
    const b = this.bounds()
    const cam = this.cameras.main
    const keyOf = () => [r.left, r.top, r.width, r.height, c.left, c.top, c.width, c.height, b.b,
      ...els.flatMap((e) => { const a = e.getBoundingClientRect(); return [a.left, a.top, a.right, a.bottom] })].join()
    if (!r.width || !r.height || keyOf() === this.fitKey) return
    // v: the zoom, and a world point (wx, wy) with the viewport point it shows at (sx, sy). The floor fills the
    // page around it.
    const v = this.around(r, b, els)
    cam.setViewport(0, 0, Math.round(c.width), Math.round(c.height))
    const [ox, oy] = [c.left + cam.x, c.top + cam.y]
    const mx = v.wx - (v.sx - ox - cam.width / 2) / v.z
    const my = v.wy - (v.sy - oy - cam.height / 2) / v.z
    cam.setZoom(v.z)
    cam.centerOn(mx, my)
    const was = this.view?.z
    this.view = { mx, my, z: v.z, w: cam.width, h: cam.height, ox, oy }
    this.fitKey = keyOf()
    // A new zoom: the labels laid out by their size (the Move squares', the bodies behind the camp) are laid
    // out again at it, and the board fitted again (the bodies behind the camp may take more room); a small
    // change only rescales them.
    if (this.picture && (was == null || Math.abs(v.z / was - 1) > 0.02)) {
      this.draw(this.picture)
      this.fitKey = ''
    } else for (const t of [...this.layer, this.domLabel]) if (t?.getData?.('legible')) legible(t, v.z)
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

  tileAt (x, y) {
    if (!this.view) return null
    const p = this.toWorld(x, y)
    const wr = this.waitRect
    if (wr && p.x >= wr.l && p.x <= wr.r && p.y >= wr.t && p.y <= wr.b) return 'reserve'
    if (Math.abs(p.x) > LANES / 2 * SPREAD) return null
    const tx = Math.round(p.x / SPREAD + (LANES - 1) / 2)
    let ty = Math.round((DEPTH - 1) / 2 - (p.y + HIT_UP) / ROW_PX)
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
    this.drag = { key: a ? what : null, a, sprite, ghost, chest: a?.chest ?? 30, preview: null }
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
      const p = this.toWorld(x, y)
      d.sprite.setPosition(p.x, p.y + d.chest)
      if (d.a) d.a.drop = d.preview?.tile != null ? posFor(d.preview.tile) : { x: p.x, y: p.y + d.chest }
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
    for (const tile of preview?.falter ?? []) {
      const c = posFor(tile)
      const t = this.add.text(c.x + BAR / 2 + 3, c.y + BAR_DROP + 2, `×${TUNING.monarch.falter}`, { fontFamily: FONT, fontSize: '10px', fontStyle: 'bold', color: C.foe, stroke: '#07060b', strokeThickness: 3 })
        .setResolution(3).setOrigin(0, 0.5).setDepth(9610)
      g.fillStyle(0x2a1018, 0.9).fillRoundedRect(t.x - 3, t.y - 8, t.width + 6, 16, 4)
      g.lineStyle(1, FOE, 0.8).strokeRoundedRect(t.x - 3, t.y - 8, t.width + 6, 16, 4)
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
  }

  // ── into the battle ──────────────────────────────────────────────────────────────────────────

  // The battle is built under this picture: it plays one frame (its units take their size) and holds, the prep
  // marks fade, and once that heavy first frame is past the camera glides to the battle's view and the board
  // fades into the battle's own, which starts as it shows. The battle may end at any moment of it (Skip): then
  // the handoff stops where it is, and so does this scene; a stopped battle is never resumed.
  handoff (battle) {
    if (!this.leaving || !this.sys.isActive()) return
    if (this.drag) this.dropped()
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
