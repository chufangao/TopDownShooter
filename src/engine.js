// Phaser, used for battles only: the one Phaser Game, the scene that loads the unit and prop pictures and
// makes the FX textures, the battle scene, and the timeline player that turns sim events into tweens and
// FX. It never decides anything: it steps a battle that takes no input and plays back what the sim emitted.
import Phaser from './vendor/phaser.js'
import { TUNING } from './tuning.js'
import { UNIT_LIST, unitDef, statusDef, animDef, abilityDef, artUrl, ART_POSES, BONDS, relicDef, SYNERGIES } from './content.js'
import { stepBattle, nextCost, rulesOf } from './sim/battle.js'
import { foeEssence } from './sim/run.js'
import { tileX, tileY, LANES, DEPTH, TILES, ROWS, CAMP_ROWS, distance, rangeOf } from './sim/unit.js'

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
    // onDone(), banners (a Map of captain uid → its banner's '#rrggbb', for a Marshal's domain), essence (what
    // the purse multiplies a slain foe's essence by: 1 + the relics') }. Resolves with the scene once built.
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
const CROWN = 0xf0c060 // the Monarch's frame: if its HP runs out, the run ends
const RISE = 0xc8f5d2  // Arise's pale green
const UNDYING = 0xffd98a // a captain rising again (Undying)
const TITHE = '#ff6a8a'  // the HP Blood Tithe takes from the Monarch
const RELIC = '#f3d9a0'  // a trigger relic's name as it fires
const SHADE_ALPHA = 0.8 // a shadow is see-through
const RANK_SCALE = 0.8  // rank-and-file stand smaller than the named souls who lead them
const PLAN_ALPHA = 0.38 // the plans are drawn faint under the units: they are what you asked, not what happens
// A held detachment's start, short, for its square's label and the reserve HUD.
const START = { struck: 'STRUCK', wave: 'WAVE', falls: 'FALLS' }
const startTag = (w) => (w.at === 'time' ? `${+(w.t * TUNING.tick.ms / 1000).toFixed(1)} S` : START[w.at])
const hex = (c) => parseInt(c.slice(1), 16)
const MARSHAL = 0xe8b04b // a Marshal's domain with no banner colour to wear
const FLOAT_ROWS = 4    // popups over one unit stack this many rows high at once (see floating)
// ms a popup holds its row (by then it has drifted most of a row up, and faded): one that comes sooner takes
// a row above it, or waits for one. Long enough to cover the beat between an event (a rule's name) and the
// numbers its action's impact shows a few hundred ms later.
const FLOAT_HOLD = 520
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

// ── battle scene ─────────────────────────────────────────────────────────────────────────────────

// The battle screen: the shared board, the party's walled camp at the bottom and the foes at the top.
// It steps the battle on the same clock that plays the events back. Pause, speed and skip change only the
// playback; the outcome was fixed when it began.

const ROW_PX = 64     // between board rows
const SPREAD = 84     // between lanes
const EDGE = (DEPTH - 1) / 2 * ROW_PX // board centre → the top and bottom rows
const rowY = (y) => ((DEPTH - 1) / 2 - y) * ROW_PX
const WALK_MS = 300
// A flanker's vault over bodies: base + perBody per body vaulted, at most max (a unit steps every 800 ms).
const LEAP_MS = { base: 340, perBody: 120, max: 700 }
const LEAP_HURRY = 3
const AIR = 2 * EDGE + 2 * ROW_PX // depth added while vaulting: above every unit, below the FX
const SCALE = 0.95      // world px per unit of a picture's viewBox
const WALL_SCALE = 1
const BREATH = 0.014    // idle breathing: the share of its height a unit swells by
const REST = { lean: 0, sx: 0, sy: 0, dx: 0, dy: 0 } // a unit's pose at rest: see animate
const BAR = 46
const BAR_DROP = 14     // from the feet down to the HP bar, clear of the pictures' ground details
const BAR_PX = 56     // fallback height of the DOM playback bar under the canvas
const HEADROOM = 70    // at least this much room above their back row for its heads, under their labels
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
    this.speed = 1
    this.paused = false
    this.playMs = this.battle.t * TUNING.tick.ms
    this.ending = false
    this.hover = null
    this.crown = null
    this.waiting = null
    // The domain's outline and the tile it centres on (it moves under Vanguard Crown; see drawDomain).
    this.domainArt = null
    this.centre = null
    this.topRoom = null // room above the board for their labels: see decorate
    this.announced = new Set() // `side|rule`: the rules already named across the board this battle
    this.banners = { party: 0, foe: 0 } // announcements showing, by side, to stack them
    this.ruleBand = null // where a side's rules are announced: over its labels (see decorate)
    this.noisy = new Map() // `side|rule` → playMs its name last rose, for the NOISY rules
  }

  create () {
    this.actors = new Map()
    this.units = new Map(this.battle.units.map((u) => [u.uid, u]))
    this.emitters = new Map()
    const start = this.battle.events.find((e) => e.type === 'battle:start')
    // The Monarch's uid (null in a battle without one) and its domain's reach; your reserve, in the order
    // it enters (start.reserve: absent in a battle without an army; the foes' later waves wait in it too).
    this.monarch = start.monarch
    this.domain = start.domain
    this.reserve = (start.reserve ?? []).filter((r) => r.side !== 'foe')
    // The detachments' plans, announced at the start (one `order` event each), by id; those called so far.
    this.orders = new Map(this.battle.events.filter((e) => e.type === 'order').map((e) => [e.detachment, { ...e, colour: hex(e.color) }]))
    this.called = new Set()
    // The foes by wave (0: the formation on the board), for the banner as each arrives and the essence each
    // pays as it is slain; the foe captains (whoever a foe's cohortOf names), who carry a flag.
    const foes = [...start.units.filter((u) => u.side === 'foe'), ...(start.reserve ?? []).filter((r) => r.side === 'foe')]
    this.waves = []
    for (const f of foes) {
      const w = (this.waves[f.wave ?? 0] ??= { size: 0, left: 0, paid: 0, shown: false, when: f.when ?? null, boss: false })
      w.size++
      w.left++
      w.boss ||= !!unitDef(f.id).boss
    }
    this.foeCaptains = new Set(foes.filter((f) => f.cohortOf != null).map((f) => f.cohortOf))
    this.essence = this.args.essence ?? 1
    this.crumbling = false
    this.holdUntil = 0
    this.decorate(start)
    for (const u of start.units) this.addActor(u)
    this.drawSquares(start)
    // Redrawn every frame: the arrows to the Move squares, the ground a Stay holds (both under the units),
    // and the mark of a unit stopped to fight off its plan (over them).
    this.planG = this.add.graphics().setDepth(-385)
    this.haltG = this.add.graphics().setDepth(9050)
    // Kicked up where the dead hit the ground: low, sideways, settling.
    this.dust = this.add.particles(0, 0, 'glow', {
      emitting: false, lifespan: 650, speedX: { min: -120, max: 120 }, speedY: { min: -40, max: -5 }, gravityY: 70,
      scale: { start: 0.32, end: 0.08 }, alpha: { start: 0.45, end: 0 }, tint: [0x6e6680, 0x8a8094, 0x544c64]
    }).setDepth(9100)

    this.player = new TimelinePlayer(this, {
      template: (id) => animDef(id),
      actorOf: (uid) => this.actors.get(uid),
      tickMs: TUNING.tick.ms,
      onEvent: (ev, inAction, seq) => this.applyEvent(ev, inAction, seq)
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
    // The board, with room for the labels: this.topRoom above it (their labels, over their back row's heads),
    // 110 below.
    const top = this.topRoom ?? 110
    const zoom = Math.max(0.4, Math.min(1.5, (height - bar) / (2 * EDGE + 110 + top), width / (LANES * SPREAD + 100)))
    cam.setZoom(zoom)
    cam.centerOn(0, bar / 2 / zoom - (top - 110) / 2)
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
    // The end waits for the crumble (see crumble) to play out.
    if (b.over && this.player.finished && !this.ending && this.playMs >= this.holdUntil) this.finish()

    for (const a of this.actors.values()) {
      const x = a.sprite.x
      const y = a.sprite.y + BAR_DROP
      // The pose (see animate) and breathing, which keeps the playback clock so pause holds it. The pose's
      // dx, dy (and a vault's lift, see leap) move the picture off its feet through the origin, leaving x, y
      // to walks and lunges.
      const p = a.pose
      const breath = a.gone ? 0 : BREATH * Math.sin(this.playMs / 640 + a.uid)
      a.sprite.setScale(a.scale * (1 + p.sx), a.scale * (1 + p.sy + breath))
      a.sprite.angle = p.lean
      a.sprite.setOrigin(0.5 - p.dx / a.sprite.displayWidth, FEET - (p.dy - a.lift) / a.sprite.displayHeight)
      // The dead lie under the living who step over them.
      a.sprite.setDepth(a.gone ? a.sprite.y - ROW_PX / 2 : a.sprite.y + (a.lift > 0 ? AIR : 0))
      a.shadow.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 2)
      a.ring.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 1)
      // The bars lie on the ground under the feet, sorted with the units: whoever stands in front draws
      // over them, so they never cover a picture.
      const ground = a.sprite.y + 0.5
      a.barBg.setPosition(x, y + 2).setDepth(ground)
      a.trail.setPosition(x - BAR / 2, y).setDepth(ground + 0.1)
      a.bar.setPosition(x - BAR / 2, y).setDepth(ground + 0.2)
      a.gaugeBar.setPosition(x - BAR / 2, y + 5).setDepth(ground + 0.2)
      a.mark.setPosition(x + BAR / 2 + 3, y + 2).setDepth(ground + 0.3)
      // The rank mark rides at the shoulder, drawn with the unit (whoever stands in front still covers it).
      a.insignia?.setPosition(x - a.chest * 0.75, a.sprite.y - a.chest * 2.3 - a.lift).setDepth(a.sprite.depth + 0.05)
      if (a.realm) this.realm(a)
      a.flag?.setPosition(x - BAR / 2 - 7, y + 2).setDepth(ground + 0.3)
      a.sprite.setAlpha(a.fade * a.rise.v * (a.shade ? SHADE_ALPHA : 1))
      a.detRing?.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 1.5).setAlpha(a.gone ? 0 : 0.55 * a.rise.v)
      const u = this.units.get(a.uid)
      if (!a.gone && u.hp > 0) {
        const cost = nextCost(b, u)
        const fill = Math.min(1, u.gauge / cost)
        a.gaugeBar.width = BAR * fill
        a.gaugeBar.setFillStyle(fill >= 1 ? 0xffe9a8 : GOLD)
      }
    }

    this.drawPlans()

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

  // A shadow (u.shadow, raised by Arise, or on the foes' side by Grave Tide) wears the shade pictures; the
  // Monarch's HP bar is thicker, in a gold frame; rank-and-file (u.rank, of either side) stand at RANK_SCALE;
  // a foe captain carries a small red flag beside its bars.
  addActor (u) {
    const home = this.posFor(u.tile)
    const art = unitDef(u.id).art
    const theirs = u.side === 'foe'
    const skin = !u.shadow ? 'unit' : theirs ? 'shadefoe' : 'shade'
    if (u.shadow) shadeTextures(this, art, skin)
    const crowned = u.uid === this.monarch
    const side = u.shadow ? (theirs ? 0xe0a0bc : 0x9fd8b4) : u.side === 'party' ? PARTY : FOE
    const sprite = this.add.image(home.x, home.y, `${skin}:${art}:alive`).setOrigin(0.5, FEET).setDepth(home.y)
      .setFlipX(u.side === 'foe')
    const scale = SCALE / RES * (u.rank ? RANK_SCALE : 1)
    // Pictures are drawn on a 96 box, the boss on a bigger one; the shadow and FX heights follow.
    const size = sprite.width / RES / 96 * (u.rank ? RANK_SCALE : 1)
    // A shadow stands in a pale-green glow of its own instead of a dark pool.
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size, 13 * size, u.shadow ? (theirs ? ROT : RISE) : 0x000000, u.shadow ? 0.4 : 0.5).setDepth(home.y - 2)
    if (u.shadow) shadow.setBlendMode(Phaser.BlendModes.ADD)
    const ring = this.add.ellipse(home.x, home.y + 4, 56 * size, 17 * size).setStrokeStyle(1.5, 0xffffff, 0.8).setDepth(home.y - 1).setVisible(false)
    const barBg = this.add.rectangle(home.x, home.y + 14, BAR + 2, crowned ? 12 : 10, 0x07060b, 0.92).setStrokeStyle(1, crowned ? CROWN : 0x2c2740)
    const width = BAR * u.hp / u.maxHp
    const trail = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, 0xfff1d0, 0.85).setOrigin(0, 0.5)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, side).setOrigin(0, 0.5)
    const gaugeBar = this.add.rectangle(home.x - BAR / 2, home.y + 17, 0, 2, GOLD).setOrigin(0, 0.5)
    // Beside the bars while the unit falters (outside the domain, a shadow, or a member whose captain fell):
    // the damage it deals.
    const mark = this.text(0, 0, `×${TUNING.monarch.falter}`, 9, '#c3b0ff', 3).setOrigin(0, 0.5).setVisible(false)
    let flag = null
    if (theirs && !u.shadow && this.foeCaptains.has(u.uid)) {
      flag = this.add.graphics()
      flag.lineStyle(1.5, 0xd8c8b8, 0.9).lineBetween(0, 3, 0, -12)
      flag.fillStyle(FOE, 1).fillTriangle(0.8, -12, 10, -8.5, 0.8, -5)
    }
    // A unit of a detachment stands in a faint ring of its colour, and keeps its plan as the events tell it:
    // `where` (dropped to Hunt on arriving or faltering), `anchor` (where Stay holds: where it started or
    // entered), `halt` (stopped to fight off its plan, until it walks on).
    const order = u.det != null ? this.orders.get(u.det) : null
    const detRing = order ? this.add.ellipse(home.x, home.y + 4, 50 * size, 15 * size).setStrokeStyle(1.5, order.colour, 1).setDepth(home.y - 1.5) : null
    const actor = {
      uid: u.uid, id: u.id, side: u.side, tile: u.tile, art, skin, shade: !!u.shadow, sprite, scale, home, shadow, ring, bar, trail, barBg, gaugeBar, mark, flag,
      det: order ? u.det : null, detRing, where: order?.where ?? 'hunt', anchor: u.tile, halt: false, cohortOf: u.cohortOf ?? null,
      // chest: how far above the feet blows land and bolts fly from. fade: 0 once a corpse has risen
      // as a shadow; rise.v: a shadow coming up out of the ground (apart from `fade`, so a walk that kills
      // the actor's tweens never leaves it invisible).
      chest: 30 * size, pose: { ...REST }, hp: u.hp, maxHp: u.maxHp, gone: false, lift: 0, leaping: null, falter: false, fade: 1, rise: { v: 1 }
    }
    // A Knight's shield or a Marshal's standard beside its bars; a Marshal also carries its own domain.
    if (u.grade > 0) actor.insignia = this.insignia(u.grade, this.bannerOf(u.uid))
    if (u.grade >= 2 && u.side === 'party') actor.realm = { g: this.add.graphics().setDepth(-394), colour: this.bannerOf(u.uid), x: null, y: null }
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

  // A captain's banner colour (from data.banners), or the Marshal's gold.
  bannerOf (uid) {
    const hex = this.args.banners?.get(uid)
    return hex ? parseInt(hex.slice(1), 16) : MARSHAL
  }

  // A captain's rank mark, centred on its origin over a dark disc: a Knight's shield (gold), a Marshal's
  // standard (a gold pole flying its banner's colour).
  insignia (grade, colour) {
    const g = this.add.graphics()
    g.fillStyle(0x07060b, 0.7).fillCircle(0, 0, 8.5)
    g.setScale(1.25)
    if (grade >= 2) {
      g.lineStyle(1.5, GOLD, 1).lineBetween(-3, 6, -3, -7)
      g.fillStyle(colour, 0.95).fillTriangle(-2.5, -7, 6, -4, -2.5, -1)
      g.lineStyle(1, 0x07060b, 0.9).strokeTriangle(-2.5, -7, 6, -4, -2.5, -1)
    } else {
      const shield = [{ x: -4, y: -5 }, { x: 4, y: -5 }, { x: 4, y: 0 }, { x: 0, y: 5 }, { x: -4, y: 0 }]
      g.fillStyle(GOLD, 0.95).fillPoints(shield, true)
      g.lineStyle(1, 0x07060b, 0.9).strokePoints(shield, true)
    }
    return g
  }

  // A Marshal's own domain: TUNING.ranks.domain tiles around wherever it stands (it moves with it, following
  // the sprite between tiles), clipped to the board, faint, in its banner's colour; gone when it falls.
  realm (a) {
    const r = a.realm
    if (r.x === a.sprite.x && r.y === a.sprite.y) return
    r.x = a.sprite.x
    r.y = a.sprite.y
    const reach = TUNING.ranks.domain + 0.5
    const [bl, br] = [-LANES / 2 * SPREAD + 8, LANES / 2 * SPREAD - 8]
    const [bt, bb] = [rowY(DEPTH - 1) - ROW_PX / 2 + 8, rowY(0) + ROW_PX / 2 - 8]
    const left = Math.max(bl, r.x - reach * SPREAD + 8)
    const right = Math.min(br, r.x + reach * SPREAD - 8)
    const top = Math.max(bt, r.y - reach * ROW_PX + 8)
    const bottom = Math.min(bb, r.y + reach * ROW_PX - 8)
    r.g.clear()
    r.g.fillStyle(r.colour, 0.04).fillRoundedRect(left, top, right - left, bottom - top, 10)
    r.g.lineStyle(1.5, r.colour, 0.4).strokeRoundedRect(left, top, right - left, bottom - top, 10)
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
  // A flanker's step can carry `via`, the bodies it vaults in that one step: see leap.
  walk (ev) {
    const a = this.actors.get(ev.actor)
    if (!a || a.gone) return
    a.tile = ev.to
    a.home = this.posFor(ev.to)
    this.tweens.killTweensOf([a.sprite, a])
    a.leaping?.stop()
    a.leaping = null
    a.lift = 0
    if (ev.via?.length) return this.leap(a, ev.via.map((t) => this.posFor(t)))
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: WALK_MS, ease: 'Sine.InOut' })
    const lean = Math.sign(a.home.x - a.sprite.x) || 1
    this.animate(a, [
      { to: { lean: 5 * lean, sy: 0.05, dy: -7 }, ms: WALK_MS * 0.4, ease: 'Sine.Out' },
      { to: { lean: -2 * lean, sx: 0.06, sy: -0.07 }, ms: WALK_MS * 0.4, ease: 'Sine.In' },
      { to: REST, ms: WALK_MS * 0.2 }])
  }

  // One vault over the bodies on the tiles `over`, to a.home: a crouch, an arc high above their heads
  // along the path the sim took (through each body's tile), and a squashed landing. Longer hops take
  // longer but stay well inside one step (TUNING.board.stepTicks). The arc's height is `a.lift`, apart
  // from the pose, so a blow taken in the air doesn't drop it onto the bodies below; while aloft it draws
  // over everyone, its shadow and bars staying on the ground beneath it. A flanker often strikes the
  // moment it comes down: acting hurries the rest of the flight (see hurry).
  leap (a, over) {
    const points = [{ x: a.sprite.x, y: a.sprite.y }, ...over, a.home]
    const lens = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y))
    const total = lens.reduce((n, l) => n + l, 0) || 1
    const ms = Math.min(LEAP_MS.max, LEAP_MS.base + LEAP_MS.perBody * over.length)
    const [crouch, air, land] = [ms * 0.18, ms * 0.62, ms * 0.2]
    const height = Math.min(60, 34 + 8 * over.length)
    const lean = Math.sign(a.home.x - a.sprite.x) || 1
    // Progress along the path, eased once over the whole flight so it doesn't stall at each body.
    const flight = { at: 0 }
    a.leaping = this.tweens.add({
      targets: flight, at: 1, delay: crouch, duration: air, ease: 'Sine.InOut',
      onUpdate: () => {
        let d = flight.at * total
        let i = 0
        while (i < lens.length - 1 && d > lens[i]) d -= lens[i++]
        const f = lens[i] ? Math.min(1, d / lens[i]) : 1
        a.sprite.setPosition(points[i].x + (points[i + 1].x - points[i].x) * f, points[i].y + (points[i + 1].y - points[i].y) * f)
        a.lift = height * Math.sin(Math.PI * flight.at)
      },
      // A hurried flight can end inside the lunge that hurried it, which owns the position by then.
      onComplete: () => { a.leaping = null; a.lift = 0; if (!this.tweens.isTweening(a.sprite)) a.sprite.setPosition(a.home.x, a.home.y) }
    })
    this.animate(a, [
      { to: { lean: -4 * lean, sx: 0.1, sy: -0.14 }, ms: crouch, ease: 'Quad.Out' },
      { to: { lean: 12 * lean, sx: -0.06, sy: 0.1 }, ms: air / 2, ease: 'Sine.Out' },
      { to: { lean: 4 * lean, sy: 0.04 }, ms: air / 2, ease: 'Sine.In' },
      { to: { sx: 0.12, sy: -0.14 }, ms: land * 0.4, ease: 'Quad.Out' },
      { to: REST, ms: land * 0.6, ease: 'Back.Out' }])
  }

  // A unit that acts in mid-flight finishes the vault at LEAP_HURRY× speed, still arcing, so it comes down
  // swinging; a lunge starting meanwhile moves the sprite over the flight (the later tween wins).
  hurry (a) {
    if (a?.leaping) a.leaping.timeScale = LEAP_HURRY
    return a
  }

  // A unit that falls in mid-flight drops where it is, onto its tile.
  drop (a) {
    if (!a.leaping && !a.lift) return
    a.leaping?.stop()
    a.leaping = null
    this.tweens.add({ targets: a, lift: 0, duration: 200, ease: 'Quad.In' })
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
    this.tweens.add({ targets: this.parts(a), alpha: 0, duration: 300 })
    a.mark.setVisible(false)
    if (a.insignia) this.tweens.add({ targets: a.insignia, alpha: 0, duration: 300 })
    if (a.realm) this.tweens.add({ targets: a.realm.g, alpha: 0, duration: 500 })
  }

  // What stands beside a unit's picture: its bars, its pool of shadow, a captain's flag.
  parts (a) {
    return [a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow, a.flag].filter(Boolean)
  }

  // The Sovereign has fallen, and every foe left crumbles to dust where it stands, out from it like a ripple,
  // the nearest first: no blow before, so its bar empties at once. Their souls stream to you (they pay as if
  // slain); a foe's shadow just goes. The first to crumble sends a shudder out from the Sovereign.
  crumble (a, boss) {
    if (!this.crumbling && boss) {
      this.crumbling = true
      const wave = this.add.image(boss.sprite.x, boss.sprite.y - boss.chest, 'glow').setTint(ROT).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(40, 40).setAlpha(0.9).setDepth(9300)
      this.tweens.add({ targets: wave, displayWidth: 900, displayHeight: 520, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => wave.destroy() })
      this.cameras.main.flash(260, 70, 40, 90)
      this.cameras.main.shake(320, 0.006)
    }
    a.gone = true
    a.hp = 0
    this.drop(a)
    a.gaugeBar.width = 0
    a.bar.width = 0
    a.ring.setVisible(false)
    a.mark.setVisible(false)
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

  // Arise: the beam reaches the corpse, the corpse sinks away, and its shadow climbs out of the ground in a
  // ring of pale light. It runs as the beam is cast, not at its impact, because the shadow may step or act
  // within the same few ticks; its picture comes up as the beam lands. The Sovereign's Grave Tide raises the
  // field's dead the same way on the foes' side, in a bruised-rose light, and so does a Legion there. The
  // Legion (Undead 8, `ev.rule`) raises with no beam and no actor (ev.actor may be null), the moment its
  // corpse falls: it waits for the fall to land.
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
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(30, 10).setAlpha(0).setDepth(a.home.y - 1)
    this.tweens.add({
      targets: ring, displayWidth: 120, displayHeight: 34, alpha: { from: 0.9, to: 0 }, delay: LAND, duration: 700, ease: 'Cubic.Out',
      onStart: () => this.burst(a.home.x, a.home.y - 4, glow, 16, { up: true, speed: 90 }),
      onComplete: () => ring.destroy()
    })
  }

  // A reserve body enters beside the Monarch: it fades in out of the dark behind the camp, in a soft ring of
  // soulfire (a held detachment's too, once called). It plays at once, not at an action's impact: it may step
  // or act within the same tick. A foe of a later wave marches in over the far edge instead (see march).
  enter (ev) {
    this.units.set(ev.unit.uid, this.battle.byUid.get(ev.unit.uid) ?? this.battle.units.find((x) => x.uid === ev.unit.uid))
    this.addActor(ev.unit)
    const a = this.actors.get(ev.unit.uid)
    const glow = ev.unit.side === 'foe' ? FOE : SOUL
    a.rise.v = 0
    for (const part of this.parts(a)) part.setAlpha(0)
    if (ev.unit.side === 'foe') return this.march(a)
    this.tweens.add({ targets: a.rise, v: 1, duration: 420, ease: 'Sine.Out' })
    this.tweens.add({ targets: this.parts(a), alpha: 1, delay: 200, duration: 300 })
    for (const part of [a.insignia, a.realm?.g].filter(Boolean)) this.tweens.add({ targets: part, alpha: { from: 0, to: 1 }, delay: 200, duration: 300 })
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(90, 26).setAlpha(0.7).setDepth(a.home.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 30, displayHeight: 10, alpha: 0, duration: 520, ease: 'Cubic.In', onComplete: () => ring.destroy() })
    this.burst(a.home.x, a.home.y - 4, glow, 8, { up: true, speed: 50 })
    this.reserve = this.reserve.filter((r) => r.uid !== ev.unit.uid)
    this.showReserve()
  }

  // A foe of a later wave comes down out of the dark past the far edge onto its tile in a few hops, a red glow
  // where it lands. A step it takes meanwhile carries it on from wherever it has got to (see walk).
  march (a) {
    const MS = 560
    a.sprite.setY(a.home.y - ROW_PX * 1.3)
    this.tweens.add({ targets: a.rise, v: 1, duration: MS * 0.6, ease: 'Sine.Out' })
    this.tweens.add({ targets: a.sprite, y: a.home.y, duration: MS, ease: 'Sine.Out' })
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

  // A foe wave arrives (sim event `wave`, just before its first foe enters): its name across the open ground,
  // and a red glow along the far edge. The late pair, a later wave, or the Sovereign and its court.
  waveBanner (k) {
    const w = this.waves[k]
    const title = w?.when?.at === 'time' ? 'MORE FOES ARRIVE' : w?.boss ? 'THE HOLLOW SOVEREIGN COMES' : `THE ${ORDINAL[k] ?? `${k + 1}TH`} WAVE`
    const sub = w ? `${w.size} ${w.size === 1 ? 'foe enters' : 'foes enter'} from the far edge${w.boss ? ', its court about it' : ''}` : 'More foes enter from the far edge'
    const edge = this.add.image(0, -EDGE - ROW_PX / 2, 'glow').setTint(FOE).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(LANES * SPREAD + 160, 46).setAlpha(0).setDepth(-350)
    this.tweens.add({ targets: edge, alpha: { from: 0.75, to: 0 }, duration: 1800, ease: 'Quad.In', onComplete: () => edge.destroy() })
    const y = rowY((CAMP_ROWS + DEPTH - ROWS - 1) / 2)
    const plate = this.add.rectangle(0, y, LANES * SPREAD - 60, 46, 0x07060b, 0.84).setStrokeStyle(1, FOE, 0.45).setDepth(9590).setAlpha(0)
    const head = this.text(0, y - 7, title, 17, '#ff8a9a', 4, SERIF).setOrigin(0.5).setDepth(9600).setAlpha(0)
    const line = this.text(0, y + 12, sub, 10, '#c09aa4', 0).setOrigin(0.5).setDepth(9600).setAlpha(0)
    this.tweens.add({ targets: [plate, head, line], alpha: 1, duration: 200 })
    this.tweens.add({ targets: [plate, head, line], alpha: 0, delay: 1700, duration: 500, onComplete: () => { plate.destroy(); head.destroy(); line.destroy() } })
    this.cameras.main.shake(180, 0.003)
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
    const name = k === 0 ? 'WAVE 1' : w.when?.at === 'time' ? 'THE LATE PAIR' : `WAVE ${k + 1}`
    // Popups shown together stack down the open ground.
    const now = this.playMs
    this.payStack = now - (this.payAt ?? -1e9) < 900 ? (this.payStack ?? 0) + 1 : 0
    this.payAt = now
    const y = rowY(DEPTH - ROWS) + ROW_PX * 0.55 + this.payStack * 20
    const t = this.text(0, y, `${name} SLAIN · +${Math.round(w.paid)} ESSENCE`, 12, '#8ff7d6', 3).setOrigin(0.5).setDepth(9550).setScale(0.6)
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' })
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, delay: 1300, duration: 900, ease: 'Quad.Out', onComplete: () => t.destroy() })
    this.burst(0, y, SOUL, 12, { up: true, speed: 70 })
  }

  // The HUD's reserve lines, under the Monarch's HP: how many of yours wait behind the camp and who enters
  // next (the reserve, and the held detachments already called); then the held detachments still waiting
  // for their start. Foes still to come are never shown.
  showReserve () {
    if (!this.waiting) return
    const mine = this.reserve.filter((r) => r.side !== 'foe')
    const held = mine.filter((r) => r.when && r.when.at !== 'once' && !this.called.has(r.det))
    const queue = mine.filter((r) => !held.includes(r))
    const next = queue[0]
    const ids = [...new Set(held.map((r) => r.det))]
    const lines = [
      next ? [`RESERVE ${queue.length} · next: ${unitDef(next.id).name}`, '#8fb8a8'] : !held.length && ['RESERVE · all have entered', '#5a5470'],
      held.length > 0 && [`HELD ${held.length} · ${ids.map((id) => `${id}: ${startTag(this.orders.get(id)?.when ?? held.find((r) => r.det === id).when)}`).join('  ')}`, '#c8b47a']
    ].filter(Boolean)
    for (const [i, t] of [this.waiting, this.heldText].entries()) t.setText(lines[i]?.[0] ?? '').setColor(lines[i]?.[1] ?? '#5a5470')
  }

  // ── plans ────────────────────────────────────────────────────────────────────────────────────

  // Each Move square, faint on the ground in its detachment's colour (fainter when it lies outside the
  // domain: a one-way trip), with the detachment's id and, for a held one, its start.
  drawSquares (start) {
    const m = start.units.find((u) => u.uid === start.monarch)
    // Measured from the domain's centre as the battle starts: the Monarch's, or under Vanguard Crown the
    // front-most captain's (the `domain` event that follows the start).
    const first = this.battle.events.find((e) => e.type === 'domain')
    const c = m && (first ? first.centre : m.tile)
    const g = this.add.graphics().setDepth(-386)
    for (const o of this.orders.values()) {
      if (o.where !== 'move' || o.square == null) continue
      const p = this.posFor(o.square)
      // A one-way trip unless every soul of it is a Marshal (it never falters, so it keeps its plan out there).
      const souls = [...start.units, ...(start.reserve ?? [])].filter((u) => u.det === o.detachment && !u.rank)
      const far = m && distance(o.square, c) > start.domain && souls.some((u) => !(u.grade >= 2))
      const alpha = far ? PLAN_ALPHA * 0.5 : PLAN_ALPHA
      const [w, hgt] = [SPREAD - 14, ROW_PX - 14]
      g.fillStyle(o.colour, alpha * 0.25).fillRoundedRect(p.x - w / 2, p.y + 6 - hgt / 2, w, hgt, 9)
      g.lineStyle(2, o.colour, alpha * 1.4).strokeRoundedRect(p.x - w / 2, p.y + 6 - hgt / 2, w, hgt, 9)
      const label = `${o.detachment}${o.when && o.when.at !== 'once' ? ` · ${startTag(o.when)}` : ''}`
      // At the square's top left, unless the square is the domain box's top-left tile, where the box's
      // "DOMAIN · N" caption stands: then at its bottom left.
      const under = m && tileX(o.square) === Math.max(0, tileX(c) - start.domain) && tileY(o.square) === Math.min(DEPTH - 1, tileY(c) + start.domain)
      this.text(p.x - w / 2 + 5, under ? p.y + 6 + hgt / 2 - 3 : p.y + 6 - hgt / 2 + 3, label, 9, o.color, 0).setOrigin(0, under ? 1 : 0).setDepth(-385).setAlpha(far ? 0.5 : 0.85)
    }
  }

  // A unit's plan as it stands now: a cohort member Hunts once its captain does (it arrived, or faltered).
  planOf (a) {
    const lead = a.cohortOf != null ? this.actors.get(a.cohortOf) : null
    return lead && !lead.gone && lead.where === 'hunt' ? 'hunt' : a.where
  }

  // Every frame: from each detachment's units still on Move, an arrow to its square, from where they stand
  // (so it shortens as they close on it, and is gone once they have all arrived); under each unit on Stay,
  // the ground it holds; beside one stopped to fight off its plan, a small crossed mark.
  drawPlans () {
    const g = this.planG
    const x = this.haltG
    if (!g) return
    g.clear()
    x.clear()
    const moving = new Map()
    for (const a of this.actors.values()) {
      if (a.det == null || a.gone) continue
      const o = this.orders.get(a.det)
      const plan = this.planOf(a)
      if (plan === 'move') moving.set(a.det, [...(moving.get(a.det) ?? []), a])
      if (plan === 'stay') {
        const p = this.posFor(a.anchor)
        g.lineStyle(1.5, o.colour, PLAN_ALPHA * 1.4).strokePoints([{ x: p.x, y: p.y - 3 }, { x: p.x + 16, y: p.y + 6 }, { x: p.x, y: p.y + 15 }, { x: p.x - 16, y: p.y + 6 }], true)
      }
      if (a.halt && plan !== 'hunt') {
        const [hx, hy] = [a.sprite.x - BAR / 2 - 8, a.sprite.y + BAR_DROP + 2]
        x.lineStyle(3.5, 0x07060b, 1).lineBetween(hx - 3.5, hy - 3.5, hx + 3.5, hy + 3.5).lineBetween(hx + 3.5, hy - 3.5, hx - 3.5, hy + 3.5)
        x.lineStyle(1.6, o.colour, 1).lineBetween(hx - 3.5, hy - 3.5, hx + 3.5, hy + 3.5).lineBetween(hx + 3.5, hy - 3.5, hx - 3.5, hy + 3.5)
      }
    }
    for (const [id, as] of moving) {
      const o = this.orders.get(id)
      const to = this.posFor(o.square)
      const fx = as.reduce((n, a) => n + a.sprite.x, 0) / as.length
      const fy = as.reduce((n, a) => n + a.sprite.y, 0) / as.length + 4
      const [dx, dy] = [to.x - fx, to.y + 6 - fy]
      const len = Math.hypot(dx, dy)
      if (len < 40) continue
      const [ux, uy] = [dx / len, dy / len]
      const [ex, ey] = [to.x - ux * 24, to.y + 6 - uy * 24]
      const [bx, by] = [ex - ux * 10, ey - uy * 10]
      g.lineStyle(2, o.colour, PLAN_ALPHA).lineBetween(fx + ux * 16, fy + uy * 16, bx, by)
      g.fillStyle(o.colour, PLAN_ALPHA * 1.3).fillTriangle(ex, ey, bx - uy * 6, by + ux * 6, bx + uy * 6, by - ux * 6)
    }
  }

  // A held detachment's start has come: a word over the Monarch, in its colour; its bodies enter as there
  // is room.
  call (ev) {
    this.called.add(ev.detachment)
    const o = this.orders.get(ev.detachment)
    const m = this.actors.get(this.monarch)
    if (m && o) this.floating(m, `DETACHMENT ${ev.detachment} CALLED`, o.color, 12)
    this.showReserve()
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
    const syn = (side) => [...topSteps(start.synergies.filter((s) => s.side === side).map((s) => s.id)), ...bondNames(side)].join('  ·  ')
    // The party's labels leave room on the right for the Monarch's HP.
    const label = (y, text, colour, size, font = FONT, room = 0) => this.text(-bandW / 2 + 12, y, text, size, colour, 0, font)
      .setWordWrapWidth(bandW - 24 - room).setDepth(-300)
    const hud = start.monarch != null ? 240 : 0
    // Theirs stand above their back row, clear of the heads of whoever stands in it (a deep room can fill it),
    // the title over their synergies however many lines those wrap to; the camera makes room (fit).
    const heads = Math.max(HEADROOM, ...start.units.filter((u) => u.side === 'foe' && tileY(u.tile) === DEPTH - 1)
      .map((u) => this.textures.get(`unit:${unitDef(u.id).art}:alive`).getSourceImage().height / RES * SCALE * FEET + 6))
    const theirs = label(-EDGE - heads, syn('foe') || 'no synergies', '#9a5a62', 11).setOrigin(0, 1)
    const title = label(theirs.y - theirs.height - 3, this.args.title ?? `FLOOR ${this.battle.floor}`, '#f08a98', 16, SERIF).setOrigin(0, 1)
    this.topRoom = Math.max(110, -EDGE - title.y + title.height + 10)
    label(EDGE + 28, 'YOUR RETINUE', '#8ff7d6', 16, SERIF, hud)
    label(EDGE + 49, syn('party') || 'no synergies', '#4fa98c', 11, FONT, hud)
    // A rule is announced over its side's labels, left of the Monarch's HP: off the board, where the blows land.
    this.ruleBand = { x: -bandW / 2 + 12, party: EDGE + 40, foe: theirs.y - theirs.height / 2 }

    const m = start.units.find((u) => u.uid === start.monarch)
    if (!m) return
    // The domain, around the Monarch; under Vanguard Crown around the front-most captain, announced by the
    // `domain` event that follows the start (already in battle.events), and moving with the front.
    const first = this.battle.events.find((e) => e.type === 'domain')
    this.crowned = !!first
    this.drawDomain(first ? first.centre : m.tile)
    // The Monarch's HP, large, bottom right: when it runs out the battle and the run are lost.
    const [hx, w] = [bandW / 2 - 12, 212]
    this.text(hx - w, EDGE + 28, 'THE MONARCH', 14, '#f3d9a0', 0, SERIF).setDepth(-300)
    const hpText = this.text(hx, EDGE + 29, '', 14, '#f3d9a0', 0).setOrigin(1, 0).setDepth(-300)
    this.add.rectangle(hx - w / 2, EDGE + 55, w + 4, 9, 0x07060b, 0.92).setStrokeStyle(1, 0x5a4520).setDepth(-300)
    const hpTrail = this.add.rectangle(hx - w, EDGE + 55, w, 5, 0xfff1d0, 0.85).setOrigin(0, 0.5).setDepth(-299)
    const hpBar = this.add.rectangle(hx - w, EDGE + 55, w, 5, PARTY).setOrigin(0, 0.5).setDepth(-298)
    this.crown = { text: hpText, bar: hpBar, trail: hpTrail, w }
    this.crownHp(m)
    // Behind the camp, the reserve waits to enter beside the Monarch, and the held detachments their start.
    if (this.reserve.some((r) => r.side !== 'foe')) {
      this.waiting = this.text(hx, EDGE + 66, '', 10, '#8fb8a8', 0).setOrigin(1, 0).setDepth(-300)
      this.heldText = this.text(hx, EDGE + 80, '', 10, '#b8a87a', 0).setOrigin(1, 0).setDepth(-300)
      this.showReserve()
    }
  }

  // The domain: every tile within `this.domain` of `centre`, clipped to the board. Under Vanguard Crown it
  // moves with the front: the old outline fades out as the new one fades in, and a soft ring marks the tile
  // it centres on.
  drawDomain (centre) {
    if (centre === this.centre) return
    const moving = this.centre !== null
    this.centre = centre
    const [mx, my, r] = [tileX(centre), tileY(centre), this.domain]
    const [x0, x1] = [Math.max(0, mx - r), Math.min(LANES - 1, mx + r)]
    const [y0, y1] = [Math.max(0, my - r), Math.min(DEPTH - 1, my + r)]
    const left = (x0 - (LANES - 1) / 2) * SPREAD - SPREAD / 2 + 4
    const right = (x1 - (LANES - 1) / 2) * SPREAD + SPREAD / 2 - 4
    const dtop = rowY(y1) - ROW_PX / 2 + 2
    const dbottom = rowY(y0) + ROW_PX / 2 - 2
    const d = this.add.graphics().setDepth(-395)
    d.fillStyle(SOUL, 0.035).fillRoundedRect(left, dtop, right - left, dbottom - dtop, 12)
    d.lineStyle(1.5, this.crowned ? GOLD : SOUL, this.crowned ? 0.4 : 0.32).strokeRoundedRect(left, dtop, right - left, dbottom - dtop, 12)
    const label = this.text(left + 8, dtop + 4, this.crowned ? `DOMAIN · ${r} · VANGUARD CROWN` : `DOMAIN · ${r}`, 9, this.crowned ? '#c9a45a' : '#5fbf9f', 0).setDepth(-390).setAlpha(0.8)
    const art = [d, label]
    if (this.crowned) {
      const p = this.posFor(centre)
      art.push(this.add.image(p.x, p.y + 6, 'glow').setTint(GOLD).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(84, 26).setAlpha(0.45).setDepth(-385))
    }
    const old = this.domainArt
    this.domainArt = art
    if (!moving) return
    for (const o of art) {
      const a = o.alpha
      o.setAlpha(0)
      this.tweens.add({ targets: o, alpha: a, duration: 360, ease: 'Sine.Out' })
    }
    this.tweens.add({ targets: old, alpha: 0, duration: 360, ease: 'Sine.In', onComplete: () => old.forEach((o) => o.destroy()) })
  }

  // Undying: a captain that just fell is up again at once, on its own tile. Its fall is cut short: it slumps
  // and springs back up in a ring of warm light, its bars back under it.
  rise (a, ev) {
    a.gone = false
    a.hp = ev.hp
    this.tweens.killTweensOf([a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow])
    for (const part of [a.bar, a.trail, a.barBg, a.gaugeBar, a.shadow]) part.setAlpha(1)
    a.bar.width = a.trail.width = BAR * Math.max(0, a.hp / a.maxHp)
    a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY)
    a.mark.setVisible(a.falter)
    // A Knight's or Marshal's insignia, and a Marshal's own domain, faded with its fall: back with it.
    for (const part of [a.insignia, a.realm?.g].filter(Boolean)) {
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
    this.floating(a, 'RISES', '#ffd98a', 13)
  }

  // An HP bar set from an event (One Army's share, Blood Tithe's cost): the trail follows a loss, a gain
  // snaps it.
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

  // The HUD's Monarch HP, from its actor (or the start unit): red once it runs low.
  crownHp (a) {
    const c = this.crown
    if (!c) return
    const f = Math.max(0, a.hp / a.maxHp)
    c.text.setText(`${Math.max(0, a.hp)} / ${a.maxHp}`).setColor(f < 0.35 ? '#ff8a9a' : '#f3d9a0')
    c.bar.width = c.w * f
    c.bar.setFillStyle(f < 0.35 ? 0xff6a7a : PARTY)
    this.tweens.killTweensOf(c.trail)
    this.tweens.add({ targets: c.trail, width: c.w * f, delay: 260, duration: 380, ease: 'Quad.Out' })
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

  // `seq`: the event's place in the battle's stream (TimelinePlayer), for the HP shown.
  applyEvent (ev, inAction, seq) {
    if (ev.type === 'move') {
      // Walking on: no longer stopped (to fight, or back to its anchor, or on to its square).
      const w = this.actors.get(ev.actor)
      if (w) w.halt = false
      return this.walk(ev)
    }
    if (ev.type === 'arise') return this.arise(ev)
    if (ev.type === 'enter') return this.enter(ev)
    if (ev.type === 'wave') return this.waveBanner(ev.wave)
    if (ev.type === 'call') return this.call(ev)
    if (ev.type === 'arrive') {
      // On its square or next to it: it Hunts from now on, and its arrow is gone with it.
      const r = this.actors.get(ev.uid)
      if (!r) return
      r.where = 'hunt'
      r.halt = false
      const o = this.orders.get(r.det)
      if (o && !r.gone) this.burst(r.sprite.x, r.sprite.y, o.colour, 6, { up: true, speed: 40 })
      return
    }
    if (ev.type === 'action') {
      // Fighting while its plan says walk on (Move) or hold elsewhere (Stay, off its anchor): stopped to fight.
      const f = this.actors.get(ev.actor)
      if (f?.det != null) {
        const plan = this.planOf(f)
        if (plan === 'move' || (plan === 'stay' && f.tile !== f.anchor)) f.halt = true
      }
      return this.reshaped(ev, this.hurry(f))
    }
    if (ev.type === 'rule') return this.rule(ev)
    // Vanguard Crown moved the domain.
    if (ev.type === 'domain') return this.drawDomain(ev.centre)
    // One Army: a blow or a heal spread over the banner; any left at 0 get their own deaths next.
    if (ev.type === 'share') {
      for (const [uid, hp] of ev.hp) {
        const x = this.actors.get(uid)
        if (x && !x.gone) this.setHp(x, hp, seq)
      }
      return
    }
    // A trigger relic fired for this unit: its name flashes over it (its effects follow as their own events).
    if (ev.type === 'trigger') {
      const x = this.actors.get(ev.unit)
      if (!x) return
      this.floating(x, relicDef(ev.relic).name, RELIC, 10)
      this.burst(x.sprite.x, x.sprite.y - x.chest, GOLD, 6, { up: true, speed: 50 })
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
        if (ev.crumble) this.crumble(a, this.actors.get(ev.actor))
        else this.fall(a, this.actors.get(ev.actor))
        this.slain(a)
        break
      // Undying: the captain that just fell stands again.
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
      // Stepped out of the domain (or back in), or risen as a shadow: it deals ×falter damage while it lasts.
      // Only a step out pops "falters": those placed outside are announced at t 0, and the mark says it.
      // Outside the domain only Hunt is heeded: a unit that falters drops its plan for good.
      case 'falter':
        a.falter = ev.on
        if (ev.on) { a.where = 'hunt'; a.halt = false }
        a.mark.setVisible(ev.on && !a.gone)
        if (ev.on && !a.shade && ev.t > 0) this.floating(a, 'falters', '#c3b0ff', 10)
        break
      case 'phase':
        this.floating(a, `PHASE ${ev.phase + 1}`, '#ff6a7a', 16)
        this.cameras.main.shake(260, 0.008)
        this.cameras.main.flash(220, 120, 20, 30)
        break
    }
  }

  // A rule (an 8 step) at work: its name rises over the unit it acts through, gold for yours, red for theirs,
  // in a burst of its side's colour. Ambush has no one unit: every gauge on its side flares. Sanctuary, Echo,
  // Dragonfire and Deadeye strike on nearly every cast, so theirs rises at most once a NOISY_MS per side. The first time a
  // side's rule strikes in a battle, its name is also announced over that side's labels (announce).
  rule (ev) {
    const r = RULES[ev.rule]
    if (!r) return
    const mine = ev.side === 'party'
    const colour = mine ? GOLD : FOE
    const key = `${ev.side}|${ev.rule}`
    const quiet = NOISY.has(ev.rule) && this.playMs - (this.noisy.get(key) ?? -Infinity) < NOISY_MS
    if (NOISY.has(ev.rule) && !quiet) this.noisy.set(key, this.playMs)
    const who = ev.rule === 'ambush' || quiet ? null : this.actors.get(RULE_ON[ev.rule] === 'actor' ? ev.actor : ev.target)
    if (who) {
      this.floating(who, r.name.toUpperCase(), mine ? '#ffd98a' : '#ff9aaa', 11, 2)
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

  // A rule's name for a moment over its side's labels (yours below the board, theirs above it), off the
  // ground where the blows land; several at once stack toward the board.
  announce (r, mine) {
    const band = this.ruleBand
    if (!band) return
    const side = mine ? 'party' : 'foe'
    const y = band[side] + (mine ? -1 : 1) * 26 * (this.banners[side]++ % 3)
    const text = this.text(band.x + 18, y, `${r.step.toUpperCase()} · ${r.name.toUpperCase()}`, 15, mine ? '#ffe2a0' : '#ffa0ae', 4, SERIF)
      .setOrigin(0, 0.5).setDepth(9600).setAlpha(0)
    const plate = this.add.rectangle(band.x, y, text.width + 36, 26, 0x07060b, 0.85).setOrigin(0, 0.5).setStrokeStyle(1, mine ? GOLD : FOE, 0.6).setDepth(9590).setAlpha(0)
    this.tweens.chain({
      targets: [text, plate],
      tweens: [{ alpha: 1, duration: 160 }, { alpha: 1, duration: 800 }, { alpha: 0, duration: 400 }],
      onComplete: () => { text.destroy(); plate.destroy(); this.banners[side] = Math.max(0, this.banners[side] - 1) }
    })
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

  flash (a) {
    if (a.gone) return
    a.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(60 / this.speed, () => a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  // Floating text over a unit; several at once on one unit (a relic, its status, a blow) stack upward, up to
  // FLOAT_ROWS rows, each held FLOAT_HOLD ms (a.rows: when each comes free). A popup takes the lowest rows free
  // now, or waits for the first to come free (a burst bigger than the stack: a fall with three relics, their
  // statuses and RISES), so no popup is drawn over another. `span`: how many rows it takes (a rule's name takes
  // two, over the numbers: the blows its action lands a moment later rise above it, never into it).
  floating (a, text, colour, size = 12, span = 1) {
    const now = this.time.now
    const rows = (a.rows ??= new Array(FLOAT_ROWS).fill(0))
    let low = 0
    let at = Infinity
    for (let i = 0; i + span <= FLOAT_ROWS; i++) {
      const free = Math.max(now, ...rows.slice(i, i + span))
      if (free < at) { low = i; at = free }
    }
    for (let i = low; i < low + span; i++) rows[i] = at + FLOAT_HOLD
    const row = low + span - 1
    const wait = at - now
    const draw = () => {
      const t = this.text(a.sprite.x, a.sprite.y - a.chest - 22 - 15 * row, text, size, colour, 3).setOrigin(0.5, 1).setDepth(9500).setScale(0.6)
      this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' })
      this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, delay: 160, duration: 760, ease: 'Quad.Out', onComplete: () => t.destroy() })
    }
    if (wait) this.time.delayedCall(wait, draw)
    else draw()
  }

  finish () {
    this.setPaused(false)
    this.ending = true
    this.changed()
    const won = this.battle.winner === 'party'
    const colour = won ? SOUL : FOE
    const glow = this.add.image(0, 0, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 120).setAlpha(0).setDepth(9989)
    const plate = this.add.rectangle(0, 0, LANES * SPREAD + 120, 70, 0x07060b, 0.82).setStrokeStyle(1, colour, 0.5).setDepth(9990).setAlpha(0)
    const reason = this.battle.reason
    // A wave the Sovereign's fall cut short pays for the slain it had (a lost battle pays nothing).
    if (won && this.waves.length > 1) this.waves.forEach((_, k) => this.wavePaid(k))
    // A boss room (battle.boss, as finishBattle reads it) has no reap: the Sovereign's fall clears the run.
    const [title, line] = won ? (this.battle.boss ? ['THE SOVEREIGN FALLS', `${reason === 'sovereign' ? 'Its court crumbled with it. ' : ''}The run is cleared.`] : ['VICTORY', 'The souls of the slain linger, waiting to be reaped.'])
      : reason === 'monarch' ? ['THE MONARCH FALLS', `Its retinue crumbles with it. The run is over${this.battle.floor > TUNING.run.floors ? ', but the clear stands' : ''}.`]
        : reason === 'tick-ceiling' ? ['THE DARK CLOSES IN', 'Still undecided at the last moment: the run is lost.']
          : ['YOUR RETINUE FALLS', 'The dead return to the dark.']
    const banner = this.text(0, -8, title, 28, won ? '#8ff7d6' : '#ff6a7a', 4, SERIF)
      .setOrigin(0.5).setDepth(10000).setAlpha(0)
    const sub = this.text(0, 20, line, 11, '#a59fb8', 0)
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
    this.seq = new WeakMap() // event → its place in the stream, so a late-shown result never undoes a newer one
    this.count = 0
  }

  // An `action` owns the events that follow it in the same batch and tick (its damage, statuses…).
  // One stepBattle call is one tick, so a beat never spans two enqueue calls.
  enqueue (events) {
    let beat = null
    for (const ev of events) {
      this.seq.set(ev, this.count++)
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
    beat.results.forEach((ev, i) => {
      const run = () => this.onEvent?.(ev, !!beat.action, this.seq.get(ev))
      // A move, a shadow rising (see arise) and a body entering (see enter) play at once: the newcomer may
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

  shake (p, step) {
    p.scene.cameras.main.shake(step.dur ?? 120, (step.mag ?? 4) / 900)
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
