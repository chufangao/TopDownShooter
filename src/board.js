// The prep board: the battle's own board, drawn in Phaser under the Field tab (ui.js fieldEditor), so the army
// is arranged on the very picture the battle plays on. It draws a picture of plain data that the editor builds
// on every render (ui.js: the picture), with the plan laid over it (DESIGN §4): the roads as arrows, coverage (each
// road tile shaded by how many of your rings reach it), the stop line (where a walker first comes under a ring: the
// earliest it can halt), Arise's reach once held, the crown on the Monarch's seat, the selected piece's ring, and
// each synergy's glow; a 2×2 piece drawn large over its four tiles, a flyer hovering over its shadow. It tells the
// editor which tile lies under the pointer, lifts a piece while it is dragged (a 2×2's four cells lit under it, red
// where they do not fit), and at Begin fades into the battle with everyone where they stood. It decides nothing:
// every rule, every tooltip and every action stays in ui.js.
import Phaser from './vendor/phaser.js'
import { unitDef } from './content.js'
import { LANES, DEPTH, TILES, ROWS, CAMP_ROWS, tileX, tileY, footprint } from './sim/unit.js'
import {
  RES, FEET, SCALE, TILE_W, TILE_H, FOOT, HALF_W, HALF_H, BOX, posOf, posAt, BIG, HOVER, BOB, tileUnder, cellsBox, ringBox, fitBox, facesLeft, drawGround,
  WALLS, WALL_FOOT, WALL_SCALE, BAR, BAR_DROP, BREATH, PARTY, FOE, SOUL, CROWN, DOMAIN, PLAN, NEUTRAL, FONT, hex, growthMarks, palette, reducedMotion,
  legible, domainLabel, placeOutside, overlap, HORDE, syncHorde, placeHorde
} from './engine.js'
import { sfx } from './sfx.js'

const HIT_UP = 14                // a tile takes the pointer over its unit's body: centred this far above the feet
const MARK_X = 30                // the marks beside a unit's feet stand this far either side of it (a tile is TILE_W)
const GROUND = 6                 // a tile's ground lies this far under its centre: the arrows run on it
// A drag by touch: the piece is drawn LIFT CSS px above the finger (feet first), so the finger hides neither it
// nor the tile it would land on, and the drop goes by its feet. Where a tile stands under ZOOM_UNDER CSS px tall
// (a phone's whole board), the camera eases in on the camp for the drag and back out after (dragView).
const DRAG = { lift: 48, zoomUnder: 40, ms: 200, zoom: 1.8 }
const TOUCH_SLOP = 8
// The pointer of the last press (touch or not), read when a drag lifts.
let pointerType = 'mouse'
// Every tile becomes a point by the board's one transform (engine.js posOf: the board on its side); its ground lies
// GROUND under it.
const groundOf = (tile) => { const p = posOf(tile); return { x: p.x, y: p.y + GROUND } }
// A road's step from tile `t` to `to` (its arrow), on the ground: where it starts, and its unit direction.
function stepOn (t, to) {
  const a = groundOf(t)
  const b = groundOf(to)
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  return { a, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len }
}

let engine = null
let scene = null    // the PrepScene while it runs
let starting = false
// What to show: { stage (the editor's board element, which the camera keeps the board inside), picture }.
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
  show (stage, picture) {
    const w = { stage, picture }
    if (!stage.isConnected) {
      pending.set(stage, w)
      queueMicrotask(() => { if (pending.get(stage) === w && stage.isConnected) board.show(stage, picture) })
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

  // The board tile under a viewport point, or null; while a 2×2 is dragged, the anchor of the footprint under it.
  tileAt: (x, y) => scene?.tileAt(x, y) ?? null,
  // A tile's rect in viewport pixels, for its tooltip.
  rectOf: (tile) => scene?.rectOf(tile) ?? null,
  hover (tile) { if (scene) scene.hovered = tile },
  // Moving: lift a board piece by its key (or a soul from the bench, { id, size }), follow the pointer with what a
  // drop there would do (`preview`, see the editor's dragPreview), and put it down (the editor's next picture
  // places it).
  lift (what, x, y) { scene?.lift(what, x, y) },
  // `off`: the pointer is off the board (over the bench, the panel): the lifted piece hides (the editor shows it).
  follow (x, y, preview, off = false) { scene?.follow(x, y, preview, off) },
  drop () { scene?.dropped() },
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
    // The floor, the vignette, the two daises and the seam between them, and the motes: the battle's own.
    drawGround(this)
    this.wallArt = { key: null, art: [] }
    this.tileG = this.add.graphics().setDepth(-400)
    this.covG = this.add.graphics().setDepth(-399)
    this.roadG = this.add.graphics().setDepth(-398)
    this.stopG = this.add.graphics().setDepth(-397)
    this.domG = this.add.graphics().setDepth(-395)
    // While a piece is dragged: the domain lit (pulsing, see update) and the ground outside it dimmed.
    this.glowG = this.add.graphics().setDepth(-394)
    this.dimG = this.add.graphics().setDepth(-393)
    this.ringG = this.add.graphics().setDepth(-392)
    this.seatG = this.add.graphics().setDepth(-388) // the gold ring on the Monarch's seat
    this.crownG = this.add.graphics() // its crown, sorted with the units (drawSeat)
    this.liveG = this.add.graphics().setDepth(-384) // redrawn every frame: hover, the drop target
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

  // ── the picture ──────────────────────────────────────────────────────────────────────────────

  // p: { walls, units, domain: { centre, r } (Arise's reach, null until held), roads (each tile's arrow,
  // field().arrow), ring ({ tile, r, size, foe } or null), seat (the Monarch's tile), cover (by tile, how many of your
  // rings reach it), stops (the stop line's tiles, battle.js stopLine), drop (the anchors a drag may land on), dropSize
  // (the dragged piece's size), selKey }. A unit: { key, id, tile (its anchor), size (1, or 2: a 2×2), side, hp, maxHp,
  // lvl, tracks, count, monarch, fallen, sel, glow (colours), lit, flies (hovers) }.
  draw (p) {
    const old = this.picture
    this.picture = p
    this.drawWalls(p.walls)
    this.drawTiles(p)
    this.drawCover(p.cover)
    this.drawRoads(p.roads)
    this.drawStops(p.stops, p.roads)
    this.drawDomain(p.domain?.centre ?? null)
    this.drawRing(p.ring)
    this.drawSeat(p.seat)
    // The units, kept by key: one that changed tile walks there (a place), one that grew pops.
    const seen = new Set()
    let moved = false
    for (const u of p.units) {
      seen.add(u.key)
      let a = this.actors.get(u.key)
      if (a && (a.u.id !== u.id || a.fp !== (u.size ?? 1) || !!a.u.flies !== !!u.flies)) { this.dropActor(a, false); a = null }
      if (!a) a = this.addActor(u, !!old)
      else if (a.tile !== u.tile) {
        moved ||= u.key[0] === 's' && !a.lifted
        this.tweens.killTweensOf(a.sprite)
        const to = posAt(u.tile, a.fp)
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

  // Where an actor's feet stand: its tile's, or for a 2×2 the middle of its four (engine.js posAt).
  homeOf (a) {
    return posAt(a.tile, a.fp)
  }

  drawWalls (walls) {
    const key = walls.join()
    if (key === this.wallArt.key) return
    for (const o of this.wallArt.art) o.destroy()
    this.wallArt = {
      key,
      art: walls.map((tile) => {
        const p = posOf(tile)
        return this.add.image(p.x, p.y + 8, WALLS[(tile * 7 + (tile >> 3)) % WALLS.length]).setOrigin(0.5, WALL_FOOT)
          .setScale(WALL_SCALE / RES).setFlipX(tile % 2 === 1).setDepth(p.y)
      })
    }
  }

  // A rune under every open tile, in its side's colour; brighter where someone stands (each tile of a 2×2's), and
  // where a dragged piece may go (`drop`: a 2×2's at the middle of the four cells it would take).
  drawTiles (p) {
    const g = this.tileG.clear()
    const walls = new Set(p.walls)
    const taken = new Set(p.units.flatMap((u) => footprint(u.tile, u.size ?? 1) ?? [u.tile]))
    const big = (p.dropSize ?? 1) > 1
    const drop = new Set(big ? [] : p.drop)
    if (big) {
      for (const t of p.drop ?? []) {
        const { x, y } = posAt(t, p.dropSize)
        g.fillStyle(SOUL, 0.08).fillEllipse(x, y + GROUND, 64, 22)
        g.lineStyle(1.5, SOUL, 0.55).strokeEllipse(x, y + GROUND, 64, 22)
      }
    }
    for (let tile = 0; tile < TILES; tile++) {
      if (walls.has(tile)) continue
      const { x, y } = posOf(tile)
      const ty = tileY(tile)
      const colour = ty < CAMP_ROWS ? PARTY : ty >= DEPTH - ROWS ? FOE : NEUTRAL
      g.lineStyle(1.2, colour, taken.has(tile) ? 0.45 : 0.14).strokeEllipse(x, y + GROUND, 50, 15)
      if (drop.has(tile)) {
        g.fillStyle(SOUL, 0.08).fillEllipse(x, y + GROUND, 56, 18)
        g.lineStyle(1.5, SOUL, 0.55).strokeEllipse(x, y + GROUND, 56, 18)
      }
    }
  }

  // Coverage (DESIGN §3): every road tile your rings reach, shaded in the plan's blue by how many do, deeper with
  // each (the tile's tooltip says how many). Terrain-like, under the roads' arrows.
  drawCover (cover) {
    const g = this.covG.clear()
    if (!cover) return
    for (let t = 0; t < TILES; t++) {
      const n = cover[t]
      if (!n) continue
      const b = cellsBox(tileX(t), tileX(t), tileY(t), tileY(t), 3)
      g.fillStyle(PLAN, Math.min(0.24, 0.025 + 0.045 * n)).fillRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 7)
    }
  }

  // The roads (DESIGN §2.4): on every tile a road reaches, a small chevron toward the next tile on it, in the
  // foes' red, faint: terrain, under everything. `arrow`: each tile's next tile (−1: none, the Monarch's own).
  drawRoads (arrow) {
    const g = this.roadG.clear()
    if (!arrow) return
    for (let t = 0; t < TILES; t++) {
      if (arrow[t] < 0) continue
      const { a, ux, uy } = stepOn(t, arrow[t])
      const [cx, cy] = [a.x + ux * 12, a.y + uy * 12]
      g.lineStyle(3, FOE, 0.42)
      g.lineBetween(cx + ux * 9, cy + uy * 9, cx - ux * 5 - uy * 9, cy - uy * 5 + ux * 9)
      g.lineBetween(cx + ux * 9, cy + uy * 9, cx - ux * 5 + uy * 9, cy - uy * 5 - ux * 9)
    }
  }

  // The stop line (DESIGN §3): on each tile where a walker coming down the road first comes under one of your rings,
  // a short bar across the road at the tile's upstream edge, in the plan's blue, over the road's chevrons. `arrow`:
  // each tile's next tile, the bar drawn square to the road there.
  drawStops (stops, arrow) {
    const g = this.stopG.clear()
    if (!stops || !arrow) return
    g.lineStyle(3.5, PLAN, 0.9)
    for (const t of stops) {
      if (!(arrow[t] >= 0)) continue
      const { a, ux, uy } = stepOn(t, arrow[t])
      const [cx, cy] = [a.x - ux * 15, a.y - uy * 15]
      g.lineBetween(cx - uy * 13, cy + ux * 13, cx + uy * 13, cy - ux * 13)
    }
  }

  // Arise's reach (the domain) round `centre`, the Monarch's tile. While a piece is dragged it lights up and the
  // ground outside it dims.
  drawDomain (centre) {
    const p = this.picture
    const g = this.domG.clear()
    const glow = this.glowG.clear()
    const dim = this.dimG.clear()
    this.domLabel?.destroy()
    this.domLabel = null
    const d = p.domain
    if (!d || centre == null) return
    const box = ringBox(centre, d.r, 4)
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

  // The selected piece's ring (DESIGN §2.3): the square it fights within, measured from its footprint, outlined in
  // the plan's blue, or the foes' red for a foe of a kind already met.
  drawRing (ring) {
    const g = this.ringG.clear()
    if (!ring || !(ring.r > 0)) return
    const box = ringBox(ring.tile, ring.r, 8, ring.size ?? 1)
    const colour = ring.foe ? FOE : PLAN
    g.fillStyle(colour, 0.07).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 10)
    g.lineStyle(2.5, colour, 0.85).strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 10)
  }

  // The crown on the Monarch's seat (DESIGN §4): the camp's own cell, fixed, which nothing else may take. A gold
  // ring on its ground and a crown at the cell's front corner, clear of the Monarch's bars.
  drawSeat (tile) {
    const g = this.seatG.clear()
    const c = this.crownG.clear()
    if (tile == null) return
    const { x, y } = posOf(tile)
    g.lineStyle(2, CROWN, 0.85).strokeEllipse(x, y + GROUND, 62, 20)
    g.lineStyle(1.2, CROWN, 0.5).strokeEllipse(x, y + GROUND, 72, 24)
    // Just in front of the Monarch's picture (its depth is its feet's y), behind anyone standing lower.
    const [cx, cy, k] = [x - TILE_W / 2 + 14, y + GROUND - 6, 1.4]
    const crown = [[-9, 5], [-9, -5], [-4.5, 0], [0, -8], [4.5, 0], [9, -5], [9, 5]].map(([dx, dy]) => ({ x: cx + dx * k, y: cy + dy * k }))
    c.setDepth(y + 0.6)
    c.fillStyle(CROWN, 1).fillPoints(crown, true)
    c.lineStyle(1.5, 0x07060b, 0.95).strokePoints(crown, true)
  }

  // ── units ────────────────────────────────────────────────────────────────────────────────────

  // An actor: its picture (a 2×2's BIG× larger, at the middle of its four tiles), its pool of shadow on the
  // ground, and for a flyer the HOVER it floats at over that shadow (update).
  addActor (u, appear) {
    const art = unitDef(u.id).art
    const fp = u.size ?? 1
    const big = fp > 1 ? BIG : 1
    const home = posAt(u.tile, fp)
    const sprite = this.add.image(home.x, home.y, `unit:${art}:alive`).setOrigin(0.5, FEET).setFlipX(facesLeft(u.side))
    const size = sprite.width / RES / 96
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size * big, 13 * size * big, 0x000000, 0.5)
    const a = {
      key: u.key, sprite, shadow, scale: SCALE / RES, size, fp, big, hover: u.flies ? HOVER : 0, chest: 30 * size * big, tile: u.tile, u, parts: [], growth: null, horde: [],
      pop: { v: 0 }, rise: { v: appear ? 0 : 1 }, seed: Math.random() * 6
    }
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
    a.scale = SCALE / RES * (n > 1 ? HORDE.front : 1) * a.big
    syncHorde(this, a, n, `unit:${unitDef(u.id).art}:alive`, facesLeft(u.side))
    a.sprite.setTexture(`unit:${unitDef(u.id).art}:${u.fallen ? 'dead' : 'alive'}`)
    if (u.fallen) a.sprite.setTint(0xc4bfd0)
    else a.sprite.clearTint()
    const k = a.size * a.big
    const ring = (w, colour, alpha, line = 2) => part(this.add.ellipse(0, 0, w * k, w * 0.3 * k).setStrokeStyle(line, colour, alpha), 0, 4, 'under')
    const glow = (w, colour, alpha) => part(this.add.image(0, 0, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(w * k, w * 0.32 * k).setAlpha(alpha), 0, 4, 'under')
    // The synergies it counts toward (DESIGN §2.7): a ring a synergy in its colour, one inside the other, over
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
      part(legible(chev.setData('size', 6), this.labelZ, 'num'), 0, -a.chest * 2.95 - 4 - a.hover, 'top', { move: 0, bob: true, box: [-11, -17, 11, 5] })
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
      part(L(this.add.container(0, 0, kids), 12), -MARK_X * a.big, -7, 'mark', { z: 0.3, move: 1, box: [-(t.width + 10) / 2, -9.5, (t.width + 10) / 2, 9.5] })
    }
    // Yours wear their growth as in battle: their tiers.
    if (!foe && !u.monarch) a.growth = growthMarks(this, u)
  }

  // A unit's body as drawn at its tile (its picture's middle, from its head down to its bars; a flyer's head
  // higher by its hover), in world px.
  bodyOf (a, at = this.homeOf(a)) {
    const s = a.sprite
    const w = s.displayWidth * 0.3
    return { l: at.x - w, r: at.x + w, t: at.y - s.displayHeight * FEET * 0.92 - a.hover, b: at.y + BAR_DROP + 6 }
  }

  // The marks that carry print, laid out together so none covers another: the selected piece's first, then
  // front to back, each mark (by its `move`) nudged the least way clear of every one placed before it, and of
  // the domain's caption.
  layoutMarks () {
    const placed = []
    const units = [...this.actors.values()].sort((a, b) => (b.u.sel ? 1 : 0) - (a.u.sel ? 1 : 0) || this.homeOf(b).y - this.homeOf(a).y)
    const hasText = (o) => o.type === 'Text' || o.list?.some((c) => c.type === 'Text')
    for (const a of units) {
      const home = this.homeOf(a)
      a.growth?.place(home.x, home.y)
      for (const o of a.growth?.parts ?? []) if (hasText(o)) placed.push(boundsOf(o))
      for (const x of a.parts) {
        if (x.move != null || x.layer !== 'ground' || !hasText(x.o)) continue
        x.o.setPosition(home.x + x.dx, home.y + x.dy)
        placed.push(boundsOf(x.o))
      }
    }
    const dom = this.placeDomain(placed)
    if (dom) placed.push(dom)
    for (const a of units) {
      const home = this.homeOf(a)
      const lane = { l: home.x - TILE_W * a.fp / 2 + 2, r: home.x + TILE_W * a.fp / 2 - 2 }
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
    return placeOutside(t, this.domBox, BOX, [...bodies, ...marks.map((m) => ({ ...m, w: 4 }))])
  }

  update (time) {
    // Asleep while its editor is off screen (the Map or Codex tab, the spoils, a reliquary): the next show wakes it.
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
      // A flyer floats over its shadow, bobbing (held still under reduced motion); its marks stay on the ground.
      if (a.hover) s.setOrigin(0.5, FEET + (a.hover + (reducedMotion() ? 0 : BOB * Math.sin(time / 420 + a.seed))) / Math.max(1, s.displayHeight))
      s.setDepth(a.lifted ? 9500 + s.y : s.y)
      s.setAlpha((a.lifted ? 0.92 : 1) * a.rise.v * seen(a))
      const ground = a.lifted ? a.drop : { x: s.x, y: s.y }
      a.shadow.setPosition(ground.x, ground.y + 4).setDepth(ground.y - 2).setAlpha((a.hover ? 0.32 : 0.5) * a.rise.v * seen(a))
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
        if (!x.o.getData?.('still')) x.o.setAlpha(hide ? 0 : alpha * a.rise.v * seen(a))
        else x.o.setVisible(!hide && base > 0)
      }
      a.growth?.place(s.x, s.y)
      for (const o of a.growth?.parts ?? []) o?.setVisible(seen(a) > 0)
      placeHorde(a, s.x, s.y - a.hover, s.depth, SCALE / RES * a.big * (0.6 + 0.4 * a.rise.v), s.alpha, breath)
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

  // Redrawn every frame: the tile under the pointer, the keyboard's tile, and while a piece is moved the cells the
  // drop would take (a 2×2's four), green where they fit and red where they do not (all red, the bad ones
  // brightest, where the drop is refused); a stack's target ringed again, pulsing.
  live (v) {
    const g = this.liveG.clear()
    const p = this.picture
    if (!p || this.leaving) return
    if (this.focused != null && !this.drag) {
      const b = ringBox(this.focused, 0, 5)
      g.lineStyle(2, 0xffffff, 0.6 + 0.35 * v).strokeRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 8)
    }
    const d = this.drag?.piece ? this.drag : null
    const at = d ? d.preview?.tile : !this.drag && typeof this.hovered === 'number' ? this.hovered : null
    if (at == null) return
    if (!d) {
      const { x, y } = posOf(at)
      return g.lineStyle(1.5, 0xffffff, 0.55).strokeEllipse(x, y + GROUND, 58, 18)
    }
    const pv = d.preview
    const cells = pv.cells ?? [at]
    const bad = new Set(pv.bad ?? [])
    for (const c of cells) {
      const { x, y } = posOf(c)
      const red = !pv.ok || bad.has(c)
      const bright = !pv.ok ? bad.has(c) || !bad.size : true
      if (cells.length > 1) {
        const b = cellsBox(tileX(c), tileX(c), tileY(c), tileY(c), 4)
        g.fillStyle(red ? FOE : SOUL, red && bright ? 0.24 : 0.12).fillRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 8)
        g.lineStyle(2.5, red ? FOE : SOUL, bright ? 0.95 : 0.45).strokeRoundedRect(b.l, b.t, b.r - b.l, b.b - b.t, 8)
      } else {
        g.fillStyle(red ? FOE : SOUL, 0.12).fillEllipse(x, y + GROUND, 66, 21)
        g.lineStyle(2.5, red ? FOE : SOUL, 0.95).strokeEllipse(x, y + GROUND, 66, 21)
      }
    }
    // A stack onto a piece of its kind: a second ring, pulsing, round its feet.
    if (pv.stack) {
      const k = (pv.size ?? 1) > 1 ? BIG : 1
      const c = posAt(at, pv.size ?? 1)
      g.lineStyle(2, SOUL, 0.4 + 0.5 * v).strokeEllipse(c.x, c.y + GROUND, 84 * k, 28 * k)
    }
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

  // Fits the board's world box (the battle's, engine.js BOX: the board, with room over its top lane for heads) inside
  // the stage's rect, in the viewport, so a scroll or a resize carries it along. Checked every frame; it only moves
  // when something did.
  fit () {
    const w = want
    // A drag's eased-in view holds until the camera is back on the board's own (dragView).
    if (!w?.stage.isConnected || this.leaving || this.camAnim || this.drag?.zoomed) return
    const r = w.stage.getBoundingClientRect()
    const c = this.game.canvas.getBoundingClientRect()
    const cam = this.cameras.main
    const key = [r.left, r.top, r.width, r.height, c.left, c.top, c.width, c.height].join()
    if (!r.width || !r.height || key === this.fitKey) return
    const v = fitBox(r, BOX)
    cam.setViewport(0, 0, Math.round(c.width), Math.round(c.height))
    const [ox, oy] = [c.left + cam.x, c.top + cam.y]
    const mx = v.wx - (v.sx - ox - cam.width / 2) / v.z
    const my = v.wy - (v.sy - oy - cam.height / 2) / v.z
    cam.setZoom(v.z)
    cam.centerOn(mx, my)
    const was = this.labelZ
    this.view = this.fitted = { mx, my, z: v.z, w: cam.width, h: cam.height, ox, oy }
    this.fitKey = key
    // A new zoom: the labels laid out by their size are laid out again at it; a small change only rescales them.
    if (this.picture && (was == null || Math.abs(v.z / was - 1) > 0.02)) {
      this.draw(this.picture)
      this.fitKey = key
    } else {
      if (this.domLabel?.getData?.('legible')) legible(this.domLabel, v.z)
      for (const a of this.actors.values()) {
        for (const x of a.parts) if (x.o.getData?.('legible')) legible(x.o, v.z)
      }
      this.layoutMarks()
    }
  }

  // A drag by touch on a board whose tiles stand under DRAG.zoomUnder CSS px tall (a phone's): the view it eases in
  // to, the point under the finger (fx, fy) kept under it: your camp and the open ground with their front row's
  // feet as large as the stage holds (at most DRAG.zoom×), kept inside the stage as far as it fits. Null when that
  // would hardly zoom.
  dragView (fx, fy) {
    const f = this.fitted
    if (!f || !want?.stage.isConnected || TILE_H * f.z >= DRAG.zoomUnder) return null
    const r = want.stage.getBoundingClientRect()
    const camp = cellsBox(0, LANES - 1, 0, CAMP_ROWS, -6)
    const box = { ...camp, t: camp.t - 44 }
    const z = Math.min(r.height / (box.b - box.t), r.width / (box.r - box.l), f.z * DRAG.zoom)
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

  // Back to the board's own view at once (a handoff, a rest).
  unzoom () {
    this.camAnim = null
    if (this.fitted && this.view !== this.fitted) this.applyView(this.fitted)
  }

  toWorld (x, y) {
    const v = this.view
    return { x: v.mx + (x - v.ox - v.w / 2) / v.z, y: v.my + (y - v.oy - v.h / 2) / v.z }
  }

  toScreen (x, y) {
    const v = this.view
    return { x: v.ox + (x - v.mx) * v.z + v.w / 2, y: v.oy + (y - v.my) * v.z + v.h / 2 }
  }

  // The tile under a viewport point. A unit's drawn body takes the point first, so a press on a head picks that
  // unit, not the tile behind it: of the bodies that hold it, the one standing on the cell under the point (a
  // 2×2's head reaches over the lane behind it, whose own piece keeps its cell), else the front-most; then the
  // tile whose cell holds it. While a piece is moved by touch the drop goes by its feet, drawn DRAG.lift above the
  // finger (follow); a 2×2's by the anchor of the four cells round its feet (its lower right one on the screen:
  // unit.js footprint).
  tileAt (x, y) {
    if (!this.view) return null
    const feet = !!this.drag?.piece && this.drag.touch
    const p = this.toWorld(x, feet ? y - DRAG.lift : y)
    if (!this.drag) {
      // By touch, a press just off a body (TOUCH_SLOP CSS px) picks it too.
      const slop = pointerType !== 'touch' ? 0 : TOUCH_SLOP / this.view.z
      const cell = tileUnder(p.x, p.y - FOOT + HIT_UP)
      let best = null
      for (const a of this.actors.values()) {
        if (a.rise.v < 1 || a.sprite.alpha < 0.05) continue
        const b = this.bodyOf(a, { x: a.sprite.x, y: a.sprite.y })
        const d = Math.hypot(Math.max(0, b.l - p.x, p.x - b.r), Math.max(0, b.t - p.y, p.y - b.b))
        if (d > slop) continue
        const own = d === 0 && (footprint(a.tile, a.fp) ?? [a.tile]).includes(cell)
        const rank = d > 0 ? -d : (own ? 2e4 : 1e4) + a.sprite.y
        if (!best || rank > best.rank) best = { a, rank }
      }
      if (best) return best.a.tile
    }
    // A 2×2 dragged: its feet (under the finger by touch, a chest below the pointer by mouse) stand at the middle
    // of its four cells.
    const size = this.drag?.piece ? this.drag.size ?? 1 : 1
    if (size > 1) {
      const fy = (feet ? p.y : p.y + this.drag.chest) - FOOT
      const [ax, ay] = [p.x + (size - 1) * TILE_W / 2, fy + (size - 1) * TILE_H / 2]
      if (Math.abs(p.x) > HALF_W + 4 || fy > HALF_H + 24 || fy < -HALF_H - 50) return null
      return tileUnder(ax, ay)
    }
    // The point as the cell it falls in: by its feet, or a unit's body.
    const gy = p.y - FOOT + (feet ? -GROUND : HIT_UP)
    // Off the board, but for the heads over its top lane and the bars under its bottom one, which count as theirs.
    if (Math.abs(p.x) > HALF_W + 4 || gy > HALF_H + 24 || gy < -HALF_H - 50) return null
    return tileUnder(p.x, gy)
  }

  rectOf (tile) {
    if (!this.view || tile == null) return null
    const p = posOf(tile)
    const a = this.toScreen(p.x - TILE_W / 2, p.y - HIT_UP - TILE_H / 2)
    const z = this.toScreen(p.x + TILE_W / 2, p.y - HIT_UP + TILE_H / 2)
    return { left: a.x, top: a.y, right: z.x, bottom: z.y }
  }

  // ── moving a piece ───────────────────────────────────────────────────────────────────────────

  lift (what, x, y) {
    if (this.drag) this.dropped()
    const a = typeof what === 'string' ? this.actors.get(what) : null
    const size = a?.fp ?? what.size ?? 1
    const big = size > 1 ? BIG : 1
    let sprite = a?.sprite
    let ghost = null
    if (a) {
      this.tweens.killTweensOf(sprite)
      a.lifted = true
      a.drop = this.homeOf(a)
    } else {
      ghost = this.add.image(0, 0, `unit:${unitDef(what.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES * big).setAlpha(0.92).setDepth(9500).setFlipX(facesLeft('party'))
      sprite = ghost
    }
    this.drag = { piece: true, key: a ? what : null, a, sprite, ghost, size, chest: a?.chest ?? 30 * big, preview: null, touch: pointerType === 'touch' }
    // By touch on a small board the camera eases in on the camp for the drag (dragView), back out on the drop.
    const v = this.drag.touch && this.dragView(x, y)
    if (v) {
      this.drag.zoomed = true
      this.easeTo(v)
    }
    this.follow(x, y, null)
  }

  // The lifted piece follows the pointer (its feet under it); a new `preview` ({ tile, size, cells, bad, ok, stack,
  // swap }) shows a piece it would displace, ghosted where it would go (live draws the cells).
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
      if (d.a) d.a.drop = d.preview?.tile != null ? posAt(d.preview.tile, d.size) : { x: p.x, y: feet }
    }
    if (preview === undefined) return
    d.preview = preview
    if (d.a) d.a.drop = preview?.tile != null ? posAt(preview.tile, d.size) : d.a.drop
    this.swapGhost?.destroy()
    this.swapGhost = null
    const sw = preview?.swap
    if (sw?.to != null) {
      const c = posAt(sw.to, sw.size ?? 1)
      this.swapGhost = this.add.image(c.x, c.y, `unit:${unitDef(sw.id).art}:alive`).setOrigin(0.5, FEET).setScale(SCALE / RES * ((sw.size ?? 1) > 1 ? BIG : 1))
        .setAlpha(0.5).setTint(SOUL).setDepth(c.y).setFlipX(facesLeft('party'))
    }
  }

  // A drag ends: the lifted piece goes home (the editor's next picture places it), and an eased-in camera eases
  // back to the board's own view.
  dropped () {
    const d = this.drag
    if (!d) return
    this.drag = null
    d.ghost?.destroy()
    this.swapGhost?.destroy()
    this.swapGhost = null
    if (d.a) {
      d.a.lifted = false
      const home = this.homeOf(d.a)
      this.tweens.add({ targets: d.a.sprite, x: home.x, y: home.y, duration: 200, ease: 'Sine.Out' })
    }
    if (this.picture) this.drawDomain(this.picture.domain?.centre ?? null)
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
    const marks = [this.roadG, this.stopG, this.covG, this.ringG, this.seatG, this.crownG, this.domG, this.liveG, this.domLabel,
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
