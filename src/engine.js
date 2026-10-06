// Phaser, used for battles only: the one Phaser Game, the scene that loads the unit and prop pictures and
// makes the FX textures, the battle scene, and the timeline player that turns sim events into tweens and
// FX. It never decides anything: it steps a battle that takes no input and plays back what the sim emitted.
import Phaser from './vendor/phaser.js'
import { TUNING } from './tuning.js'
import { UNIT_LIST, unitDef, statusDef, animDef, artUrl, ART_POSES, ELEMENTS, BONDS } from './content.js'
import { stepBattle, nextCost } from './sim/battle.js'
import { tileX, tileY, LANES, DEPTH, TILES, ROWS, CAMP_ROWS } from './sim/unit.js'

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
    // data: { battle (fresh, from createBattle), title, barHeight(), onChange(state), onHover(unit | null, rect),
    // onDone() }. Resolves with the scene once built.
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

// Colours of the two sides and the soulfire that runs through the game.
const PARTY = 0x5ef0c0
const FOE = 0xe0566a
const SOUL = 0x8ff7d6
const GOLD = 0xe8b04b

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

// ── battle scene ─────────────────────────────────────────────────────────────────────────────────

// The battle screen: the shared board, the party's walled camp at the bottom and the foes at the top.
// It steps the battle on the same clock that plays the events back. Pause, speed and skip change only the
// playback; the outcome was fixed when it began.

const ROW_PX = 64     // between board rows
const SPREAD = 84     // between lanes
const EDGE = (DEPTH - 1) / 2 * ROW_PX // board centre → the top and bottom rows
const rowY = (y) => ((DEPTH - 1) / 2 - y) * ROW_PX
const WALK_MS = 300
const SCALE = 0.95      // world px per unit of a picture's viewBox
const WALL_SCALE = 1
const BREATH = 0.014    // idle breathing: the share of its height a unit swells by
const REST = { lean: 0, sx: 0, sy: 0, dx: 0, dy: 0 } // a unit's pose at rest: see animate
const BAR = 46
const BAR_DROP = 14     // from the feet down to the HP bar, clear of the pictures' ground details
const BAR_PX = 56     // fallback height of the DOM playback bar under the canvas
const STAR_SCALE = 0.15 // extra sprite scale per star above 1
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif'
const STAR_TINT = [0, 0, 0xa98bff, GOLD]

class BattleScene extends Phaser.Scene {
  constructor () { super('Battle') }

  init (data) {
    this.args = data
    this.battle = data.battle
    this.speed = 1
    this.paused = false
    this.playMs = this.battle.t * TUNING.tick.ms
    this.ending = false
    this.hover = null
  }

  create () {
    this.actors = new Map()
    this.units = new Map(this.battle.units.map((u) => [u.uid, u]))
    this.emitters = new Map()
    const start = this.battle.events.find((e) => e.type === 'battle:start')
    this.decorate(start)
    for (const u of start.units) this.addActor(u)
    // Kicked up where the dead hit the ground: low, sideways, settling.
    this.dust = this.add.particles(0, 0, 'glow', {
      emitting: false, lifespan: 650, speedX: { min: -120, max: 120 }, speedY: { min: -40, max: -5 }, gravityY: 70,
      scale: { start: 0.32, end: 0.08 }, alpha: { start: 0.45, end: 0 }, tint: [0x6e6680, 0x8a8094, 0x544c64]
    }).setDepth(9100)

    this.player = new TimelinePlayer(this, {
      template: (id) => animDef(id),
      actorOf: (uid) => this.actors.get(uid),
      tickMs: TUNING.tick.ms,
      onEvent: (ev, inAction) => this.applyEvent(ev, inAction)
    })
    // battle:start is already in battle.events; anything after it has not been played.
    this.player.enqueue(this.battle.events.slice(this.battle.events.indexOf(start) + 1))
    this.player.setSpeed(this.speed)

    this.fit()
    this.scale.on('resize', this.fit, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.fit, this)
      this.tweens.timeScale = 1
      this.args.onHover?.(null)
    })
    this.cameras.main.fadeIn(260, 6, 5, 10)
    this.lastSecond = -1
    this.changed()
    this.args.onReady?.(this)
  }

  fit () {
    const { width, height } = this.scale
    const cam = this.cameras.main
    const bar = this.args.barHeight?.() || BAR_PX
    const zoom = Math.max(0.4, Math.min(1.5, (height - bar) / (2 * EDGE + 220), width / (LANES * SPREAD + 100)))
    cam.setZoom(zoom)
    cam.centerOn(0, bar / 2 / zoom)
  }

  update (time, delta) {
    const b = this.battle
    if (!this.paused) {
      this.playMs += Math.min(delta, 250) * this.speed
      const want = Math.floor(this.playMs / TUNING.tick.ms)
      const events = []
      while (!b.over && b.t < want) events.push(...stepBattle(b))
      if (events.length) this.player.enqueue(events)
    }
    this.player.update(this.playMs)
    if (b.over && this.player.finished && !this.ending) this.finish()

    for (const a of this.actors.values()) {
      const x = a.sprite.x
      const y = a.sprite.y + BAR_DROP
      // The pose (see animate) and breathing, which keeps the playback clock so pause holds it. The pose's
      // dx, dy move the picture off its feet through the origin, leaving x, y to walks and lunges.
      const p = a.pose
      const breath = a.gone ? 0 : BREATH * Math.sin(this.playMs / 640 + a.uid)
      a.sprite.setScale(a.scale * (1 + p.sx), a.scale * (1 + p.sy + breath))
      a.sprite.angle = p.lean
      a.sprite.setOrigin(0.5 - p.dx / a.sprite.displayWidth, FEET - p.dy / a.sprite.displayHeight)
      // The dead lie under the living who step over them.
      a.sprite.setDepth(a.gone ? a.sprite.y - ROW_PX / 2 : a.sprite.y)
      a.shadow.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 2)
      a.aura?.setPosition(x, a.sprite.y + 2).setDepth(a.sprite.y - 1)
      a.ring.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 1)
      // The bars lie on the ground under the feet, sorted with the units: whoever stands in front draws
      // over them, so they never cover a picture.
      const ground = a.sprite.y + 0.5
      a.barBg.setPosition(x, y + 2).setDepth(ground)
      a.trail.setPosition(x - BAR / 2, y).setDepth(ground + 0.1)
      a.bar.setPosition(x - BAR / 2, y).setDepth(ground + 0.2)
      a.gaugeBar.setPosition(x - BAR / 2, y + 5).setDepth(ground + 0.2)
      a.stars?.setPosition(x, y + 9).setDepth(ground + 0.3)
      const u = this.units.get(a.uid)
      if (!a.gone && u.hp > 0) {
        const cost = nextCost(b, u)
        const fill = Math.min(1, u.gauge / cost)
        a.gaugeBar.width = BAR * fill
        a.gaugeBar.setFillStyle(fill >= 1 ? 0xffe9a8 : GOLD)
      }
    }

    const second = Math.floor(b.t * TUNING.tick.ms / 1000)
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

  // Leave now; the run already knows how the battle ended.
  skip () {
    const done = this.args.onDone
    if (!done) return
    this.args.onDone = null
    this.scene.stop()
    done()
  }

  changed () {
    this.args.onChange?.({
      paused: this.paused,
      speed: this.speed,
      seconds: this.battle.t * TUNING.tick.ms / 1000,
      over: this.ending
    })
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  posFor (tile) {
    return { x: (tileX(tile) - (LANES - 1) / 2) * SPREAD, y: rowY(tileY(tile)) }
  }

  addActor (u) {
    const home = this.posFor(u.tile)
    const art = unitDef(u.id).art
    const star = u.star ?? 1
    const side = u.side === 'party' ? PARTY : FOE
    const sprite = this.add.image(home.x, home.y, `unit:${art}:alive`).setOrigin(0.5, FEET).setDepth(home.y)
      .setFlipX(u.side === 'foe')
    const scale = SCALE / RES * (1 + STAR_SCALE * (star - 1))
    // Pictures are drawn on a 96 box, the boss on a bigger one; the shadow and FX heights follow.
    const size = sprite.width / RES / 96 * (1 + STAR_SCALE * (star - 1))
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size, 13 * size, 0x000000, 0.5).setDepth(home.y - 2)
    const aura = star > 1
      ? this.add.image(home.x, home.y + 2, 'glow').setTint(STAR_TINT[star]).setBlendMode(Phaser.BlendModes.ADD).setScale(1.5, 0.6).setAlpha(0.55).setDepth(home.y - 1)
      : null
    if (aura) this.tweens.add({ targets: aura, alpha: 0.25, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut' })
    const ring = this.add.ellipse(home.x, home.y + 4, 56 * size, 17 * size).setStrokeStyle(1.5, 0xffffff, 0.8).setDepth(home.y - 1).setVisible(false)
    const barBg = this.add.rectangle(home.x, home.y + 14, BAR + 2, 10, 0x07060b, 0.92).setStrokeStyle(1, 0x2c2740)
    const width = BAR * u.hp / u.maxHp
    const trail = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, 4, 0xfff1d0, 0.85).setOrigin(0, 0.5)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, 4, side).setOrigin(0, 0.5)
    const gaugeBar = this.add.rectangle(home.x - BAR / 2, home.y + 17, 0, 2, GOLD).setOrigin(0, 0.5)
    const stars = star > 1 ? this.text(home.x, home.y + 21, '★'.repeat(star), 9, '#' + STAR_TINT[star].toString(16), 2).setOrigin(0.5, 0) : null
    const actor = {
      uid: u.uid, id: u.id, side: u.side, tile: u.tile, art, sprite, scale, home, shadow, aura, ring, bar, trail, barBg, gaugeBar, stars,
      // chest: how far above the feet blows land and bolts fly from.
      chest: 30 * size, pose: { ...REST }, hp: u.hp, maxHp: u.maxHp, gone: false
    }
    sprite.setInteractive(this.input.makePixelPerfect())
    sprite.on('pointerover', (p) => {
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
    a.sprite.setTexture(`unit:${a.art}:${pose}`)
  }

  // A living unit's poses. `toward` is the other unit in the exchange (the target for an attacker, the
  // attacker for the hurt): leans and lunges point at it.
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

  // A step to the next tile, hopping; whatever tween was moving the sprite (a lunge's return) gives way.
  walk (ev) {
    const a = this.actors.get(ev.actor)
    if (!a || a.gone) return
    a.tile = ev.to
    a.home = this.posFor(ev.to)
    this.tweens.killTweensOf(a.sprite)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: WALK_MS, ease: 'Sine.InOut' })
    const lean = Math.sign(a.home.x - a.sprite.x) || 1
    this.animate(a, [
      { to: { lean: 5 * lean, sy: 0.05, dy: -7 }, ms: WALK_MS * 0.4, ease: 'Sine.Out' },
      { to: { lean: -2 * lean, sx: 0.06, sy: -0.07 }, ms: WALK_MS * 0.4, ease: 'Sine.In' },
      { to: REST, ms: WALK_MS * 0.2 }])
  }

  // Death: the unit staggers back from its killer and topples over at the feet; where it hits the ground
  // it becomes its corpse in a puff of dust, its soul leaves, and the corpse stays under the living.
  fall (a, killer) {
    a.gone = true
    a.gaugeBar.width = 0
    a.ring.setVisible(false)
    this.picture(a, 'alive')
    // A unit can die mid-lunge; its return step is skipped once it is gone, so send it home now.
    this.tweens.killTweensOf(a.sprite)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: 200, ease: 'Sine.Out' })
    const away = killer ? Math.sign(a.sprite.x - killer.sprite.x) || (a.uid % 2 ? 1 : -1) : 1
    const land = () => {
      a.sprite.setTint(0xc4bfd0)
      this.dust.explode(14, a.home.x, a.home.y - 4)
      this.cameras.main.shake(90, 0.0025)
      this.wisp(a)
    }
    this.animate(a, [
      { to: { lean: 10 * away, sx: 0.06, sy: -0.08, dx: 6 * away }, ms: 130, ease: 'Quad.Out' },
      { to: { lean: 84 * away, sy: -0.06, dx: 4 * away }, ms: 300, ease: 'Quad.In' },
      { to: { sx: 0.12, sy: -0.2 }, ms: 1, picture: 'dead', start: land },
      { to: REST, ms: 280, ease: 'Back.Out' }])
    this.tweens.add({ targets: [a.bar, a.trail, a.barBg, a.gaugeBar, a.aura, a.stars, a.shadow].filter(Boolean), alpha: 0, duration: 300 })
  }

  decorate (start) {
    const bandW = LANES * SPREAD + 90
    this.add.tileSprite(0, 0, 2400, 2000, 'floor').setTileScale(0.6).setAlpha(0.62).setDepth(-1000)
    this.add.image(0, 0, 'vignette').setDisplaySize(bandW + 700, 2 * EDGE + 700).setDepth(-999)
    // A dais under the camp and under the foes' formation, a seam of soulfire across the open ground
    // between, the camp's walls, and a rune under every other tile; the tiles the battle starts on glow.
    const g = this.add.graphics().setDepth(-400)
    const zone = (y) => (y < CAMP_ROWS ? PARTY : y >= DEPTH - ROWS ? FOE : 0xa98bff)
    for (const [y0, y1, colour] of [[0, CAMP_ROWS - 1, PARTY], [DEPTH - ROWS, DEPTH - 1, FOE]]) {
      const top = rowY(y1) - 40
      const h = rowY(y0) - rowY(y1) + 80
      g.fillStyle(colour, 0.045).fillRoundedRect(-bandW / 2, top, bandW, h, 18)
      g.lineStyle(1, colour, 0.22).strokeRoundedRect(-bandW / 2, top, bandW, h, 18)
    }
    const seam = rowY((CAMP_ROWS + DEPTH - ROWS - 1) / 2)
    this.add.image(0, seam, 'glow').setDisplaySize(bandW + 260, 26).setTint(0xa98bff).setAlpha(0.35).setBlendMode(Phaser.BlendModes.ADD).setDepth(-390)
    const walls = new Set(start.walls)
    for (const tile of walls) {
      const p = this.posFor(tile)
      // One of the wall pictures, picked by the tile so a camp always looks the same.
      this.add.image(p.x, p.y + 8, WALLS[(tile * 7 + (tile >> 3)) % WALLS.length]).setOrigin(0.5, WALL_FOOT)
        .setScale(WALL_SCALE / RES).setFlipX(tile % 2 === 1).setDepth(p.y)
    }
    const occupied = new Set(start.units.map((u) => u.tile))
    for (let tile = 0; tile < TILES; tile++) {
      if (walls.has(tile)) continue
      const p = this.posFor(tile)
      const colour = zone(tileY(tile))
      const on = occupied.has(tile)
      g.lineStyle(1.2, colour, on ? 0.5 : 0.14).strokeEllipse(p.x, p.y + 6, 50, 15)
      if (on) this.add.image(p.x, p.y + 6, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(70, 22).setAlpha(0.3).setDepth(-380)
    }
    // Drifting motes of soulfire.
    this.add.particles(0, 0, 'glow', {
      x: { min: -bandW / 2 - 60, max: bandW / 2 + 60 },
      y: { min: -EDGE - 68, max: EDGE + 68 },
      lifespan: 7000,
      speedY: { min: -14, max: -4 },
      speedX: { min: -6, max: 6 },
      scale: { start: 0.14, end: 0 },
      alpha: { start: 0.45, end: 0 },
      tint: [SOUL, 0xa98bff],
      frequency: 160,
      blendMode: 'ADD'
    }).setDepth(-300)

    const sideOf = new Map(start.units.map((u) => [u.uid, u.side]))
    const bondNames = (side) => [...new Set(start.bonds.filter((b) => sideOf.get(b.uid) === side).map((b) => `◆ ${BONDS.find((x) => x.id === b.id).name}`))]
    const syn = (side) => [...start.synergies.filter((s) => s.side === side).map((s) => s.name), ...bondNames(side)].join('  ·  ')
    const label = (y, text, colour, size, font = FONT) => this.text(-bandW / 2 + 12, y, text, size, colour, 0, font)
      .setWordWrapWidth(bandW - 24).setDepth(-300)
    const top = -EDGE - 66
    label(top - 6, this.args.title ?? `FLOOR ${this.battle.floor}`, '#f08a98', 16, SERIF)
    label(top + 15, syn('foe') || 'no synergies', '#9a5a62', 11)
    label(EDGE + 28, 'YOUR RETINUE', '#8ff7d6', 16, SERIF)
    label(EDGE + 49, syn('party') || 'no synergies', '#4fa98c', 11)
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
  wisp (a) {
    const mine = a.side === 'party'
    const orb = this.add.image(a.sprite.x, a.sprite.y - a.chest, 'glow').setTint(mine ? 0xb8b4c8 : SOUL).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45).setDepth(9400)
    const trail = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: 6, scale: { start: 0.5, end: 0 }, alpha: { start: 0.8, end: 0 },
      tint: mine ? 0xb8b4c8 : SOUL, frequency: 30, blendMode: 'ADD'
    }).setDepth(9399)
    trail.startFollow(orb)
    const done = () => { trail.stopFollow(); trail.stop(); orb.destroy(); this.time.delayedCall(600, () => trail.destroy()) }
    if (mine) {
      this.tweens.add({ targets: orb, y: orb.y - 70, alpha: 0, scale: 0.2, duration: 1300, ease: 'Sine.Out', onComplete: done })
    } else {
      this.tweens.chain({
        targets: orb,
        tweens: [
          { y: orb.y - 30, scale: 0.6, duration: 380, ease: 'Sine.Out' },
          { x: 0, y: EDGE + 108, scale: 0.25, alpha: 0.2, duration: 900, ease: 'Cubic.In' }
        ],
        onComplete: done
      })
    }
  }

  // ── react to events the sim already decided ──────────────────────────────────────────────────

  applyEvent (ev, inAction) {
    if (ev.type === 'move') return this.walk(ev)
    const a = ev.target != null ? this.actors.get(ev.target) : null
    if (!a) return
    switch (ev.type) {
      case 'damage':
      case 'heal': {
        a.hp = ev.hp
        const w = BAR * Math.max(0, a.hp / a.maxHp)
        a.bar.width = w
        this.tweens.killTweensOf(a.trail)
        if (ev.type === 'damage') {
          this.tweens.add({ targets: a.trail, width: w, delay: 260, duration: 380, ease: 'Quad.Out' })
          if (ev.damage > 0) {
            // Knocked back from the attacker; a tick of poison or burn has no attacker to face, so it shudders.
            this.strike(a, 'hurt', inAction ? this.actors.get(ev.actor) : null)
            this.flash(a)
            this.burst(a.sprite.x, a.sprite.y - a.chest, tint(ev.element), ev.isCrit ? 22 : 9, { speed: ev.isCrit ? 220 : 140 })
            if (ev.isCrit) this.cameras.main.shake(140, 0.005)
          }
        } else {
          a.trail.width = w
          if (ev.heal > 0) this.burst(a.sprite.x, a.sprite.y - 6, 0x7be0a0, 8, { up: true, speed: 50 })
          if (!inAction && ev.heal > 0) this.floating(a, `+${ev.heal}`, '#7be0a0')
        }
        break
      }
      case 'death':
        this.fall(a, this.actors.get(ev.actor))
        break
      case 'status':
        this.floating(a, statusDef(ev.status).name, '#c3b0ff', 10)
        break
      case 'cleanse':
        this.burst(a.sprite.x, a.sprite.y - a.chest, 0x7be0a0, 6, { up: true, speed: 40 })
        break
      case 'gauge':
        this.burst(a.sprite.x, a.sprite.y - a.chest, 0x66c8ff, 6, { speed: 60 })
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
        this.cameras.main.shake(260, 0.008)
        this.cameras.main.flash(220, 120, 20, 30)
        break
    }
  }

  // Canvas text, drawn at 3× so it stays sharp when the camera zooms.
  text (x, y, str, size, colour, stroke = 0, font = FONT) {
    return this.add.text(x, y, str, { fontFamily: font, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: '#07060b', strokeThickness: stroke })
      .setResolution(3)
  }

  flash (a) {
    if (a.gone) return
    a.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(60 / this.speed, () => a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  floating (a, text, colour, size = 12) {
    const t = this.text(a.sprite.x, a.sprite.y - a.chest - 22, text, size, colour, 3).setOrigin(0.5, 1).setDepth(9500).setScale(0.6)
    this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' })
    this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, delay: 160, duration: 760, ease: 'Quad.Out', onComplete: () => t.destroy() })
  }

  finish () {
    this.setPaused(false)
    this.ending = true
    this.changed()
    const won = this.battle.winner === 'party'
    const colour = won ? SOUL : FOE
    const glow = this.add.image(0, 0, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 120).setAlpha(0).setDepth(9989)
    const plate = this.add.rectangle(0, 0, LANES * SPREAD + 120, 70, 0x07060b, 0.82).setStrokeStyle(1, colour, 0.5).setDepth(9990).setAlpha(0)
    const banner = this.text(0, -8, won ? 'VICTORY' : this.battle.winner === 'foe' ? 'YOUR RETINUE FALLS' : 'STALEMATE', 28, won ? '#8ff7d6' : '#ff6a7a', 4, SERIF)
      .setOrigin(0.5).setDepth(10000).setAlpha(0)
    const sub = this.text(0, 20, won ? 'The souls of the slain linger, waiting to be reaped.' : 'The dead return to the dark.', 11, '#a59fb8', 0)
      .setOrigin(0.5).setDepth(10000).setAlpha(0)
    this.tweens.add({ targets: [plate, banner, sub], alpha: 1, duration: 260 })
    this.tweens.add({ targets: glow, alpha: 0.5, duration: 400 })
    this.time.delayedCall(1600, () => {
      this.cameras.main.fadeOut(260, 6, 5, 10)
      this.cameras.main.once('camerafadeoutcomplete', () => this.skip())
    })
  }
}

// ── timeline player ──────────────────────────────────────────────────────────────────────────────

// Sim events → tweens, poses and FX. The player only reads events; it never computes a result.
// Events are appended as the battle steps (always in tick order) and played when the playhead,
// which the scene drives with the same clock as the sim, reaches their tick.

const ESSENTIAL = new Set(['anim', 'popup', 'tween'])

class TimelinePlayer {
  constructor (scene, { template, actorOf, tickMs = 50, onEvent = null }) {
    this.scene = scene
    this.template = template
    this.actorOf = actorOf
    this.tickMs = tickMs
    this.onEvent = onEvent
    this.playhead = 0
    this.speed = 1
    this.queue = []       // beats: { at, action, results }
    this.cursor = 0
    this.scheduled = []   // { at, run }
    this.warned = new Set()
  }

  // An `action` owns the events that follow it in the same batch and tick (its damage, statuses…).
  // One stepBattle call is one tick, so a beat never spans two enqueue calls.
  enqueue (events) {
    let beat = null
    for (const ev of events) {
      const at = ev.t * this.tickMs
      if (ev.type === 'action') {
        beat = { at, action: ev, results: [] }
        this.queue.push(beat)
      } else if (beat && ev.t === beat.action.t) {
        beat.results.push(ev)
      } else {
        this.queue.push({ at, action: null, results: [ev] })
        beat = null
      }
    }
  }

  setSpeed (n) {
    this.speed = n
    this.scene.tweens.timeScale = n
  }

  get finished () {
    return this.cursor >= this.queue.length && this.scheduled.length === 0
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
    for (const ev of beat.results) {
      const run = () => this.onEvent?.(ev, !!beat.action)
      if (impact && ev.type !== 'move') this.scheduled.push({ at: this.playhead + impact, run })
      else run()
    }
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

const tint = (element) => parseInt((ELEMENTS[element]?.tint ?? '#d8d4cc').slice(1), 16)

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
    const ring = p.scene.add.image(at.x, at.y - lift, 'glow').setTint(tint(refs.beat.action.element))
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
      .setTint(tint(refs.beat.action.element)).setBlendMode(Phaser.BlendModes.ADD).setDepth(9250)
      .setRotation(angle).setScale(0.35, 0.35 * flip).setAlpha(0)
    p.scene.tweens.add({ targets: arc, scaleX: 0.75, scaleY: 0.75 * flip, alpha: { from: 1, to: 0 }, rotation: angle + 0.6 * flip, duration: 240, ease: 'Cubic.Out', onComplete: () => arc.destroy() })
  },

  projectile (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const colour = tint(refs.beat.action.element)
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
    const colour = tint(refs.beat.action.element)
    const [up, down] = [refs.actor.chest, (refs.primary ?? refs.actor).chest]
    const glow = p.scene.add.line(0, 0, from.x, from.y - up, to.x, to.y - down, colour, 0.35)
      .setOrigin(0, 0).setLineWidth(6).setBlendMode(Phaser.BlendModes.ADD).setDepth(9000)
    const line = p.scene.add.line(0, 0, from.x, from.y - up, to.x, to.y - down, 0xffffff, 0.9)
      .setOrigin(0, 0).setLineWidth(1.5).setDepth(9001)
    p.scene.tweens.add({ targets: [glow, line], alpha: 0, duration: step.dur ?? 220, onComplete: () => { glow.destroy(); line.destroy() } })
  },

  shake (p, step) {
    p.scene.cameras.main.shake(step.dur ?? 120, (step.mag ?? 4) / 900)
  },

  // The numbers on screen are read off the events the sim already computed.
  popup (p, step, refs) {
    for (const ev of refs.beat.results) {
      if (ev.type !== 'damage' && ev.type !== 'heal') continue
      const value = ev.type === 'heal' ? ev.heal : ev.damage
      const target = p.actorOf(ev.target)
      if (!value || !target) continue
      p.scene.floating(target, `${ev.type === 'heal' ? '+' : ''}${value}${ev.isCrit ? '!' : ''}`,
        ev.type === 'heal' ? '#7be0a0' : ev.isCrit ? '#ffd28a' : '#f4ece0', ev.isCrit ? 18 : 13)
    }
  }
}
