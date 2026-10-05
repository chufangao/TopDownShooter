// Phaser, used for battles only: the one Phaser Game, the scene that loads the baked atlas, the battle
// scene, and the timeline player that turns sim events into tweens and FX. It never decides anything;
// it plays back what the sim emitted and sends player input through act(action).
import Phaser from './vendor/phaser.js'
import atlasData from './assets/atlas-0.json' with { type: 'json' }
import anims from './assets/anims.json' with { type: 'json' }
import { TUNING } from './tuning.js'
import { unitDef, statusDef, animDef, ELEMENTS } from './content.js'
import { canIssue, viable } from './sim/battle.js'
import { rowOf, colOf, SLOTS } from './sim/unit.js'

// ── engine and atlas loading ─────────────────────────────────────────────────────────────────────

export function createEngine (parent) {
  let ready
  const loaded = new Promise((resolve) => { ready = resolve })
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0a0e',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    callbacks: { preBoot: (g) => g.registry.set('ready', ready) },
    scene: [BootScene, BattleScene]
  })
  return {
    game,
    // data: { battle, act(action) → events, title, barHeight(), onChange(state), onDone() }. Resolves with the scene once built.
    async battle (data) {
      await loaded
      return new Promise((resolve) => game.scene.start('Battle', { ...data, onReady: resolve }))
    }
  }
}

const atlasPng = new URL('./assets/atlas-0.png', import.meta.url).href

const TEXTURE = 'units'

class BootScene extends Phaser.Scene {
  constructor () { super('Boot') }

  preload () {
    this.load.atlas(TEXTURE, atlasPng, atlasData)
    this.load.on('loaderror', (file) => console.error('failed to load', file.key, file.src))
  }

  create () {
    for (const a of anims) {
      if (this.anims.exists(a.key)) continue
      this.anims.create({
        key: a.key,
        frames: a.frames.map((frame) => ({ key: TEXTURE, frame })),
        frameRate: a.frameRate,
        repeat: a.repeat
      })
    }
    this.registry.get('ready')?.()
  }
}

// ── battle scene ─────────────────────────────────────────────────────────────────────────────────

// The battle screen: two facing 3×4 formations. It advances the sim on the same clock that plays the
// events back, and issues Commands between ticks; both go through act(action), i.e. the run's apply().

const GAP = 64        // centre line → each side's front row
const DEPTH = 74      // between rows
const SPREAD = 104    // between columns
const SCALE = 1.6
const BAR = 46
const BAR_PX = 72     // fallback height of the DOM command bar under the canvas
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const VERB_NAME = { focus: 'Focus', parley: 'Parley', brace: 'Brace', unleash: 'Unleash' }

class BattleScene extends Phaser.Scene {
  constructor () { super('Battle') }

  init (data) {
    this.args = data
    this.battle = data.battle
    this.speed = 1
    this.paused = false
    this.playMs = this.battle.t * TUNING.tick.ms
    this.targeting = null
    this.ending = false
    this.message = ''
    this.hover = null
  }

  create () {
    this.actors = new Map()
    this.units = new Map(this.battle.units.map((u) => [u.uid, u]))
    const start = this.battle.events.find((e) => e.type === 'battle:start')
    for (const u of start.units) this.addActor(u)
    this.decorate(start)
    this.focusMark = this.add.ellipse(0, 0, 50, 16).setStrokeStyle(2, 0xe06c6c, 0.9).setVisible(false).setDepth(-300)

    this.player = new TimelinePlayer(this, {
      template: (id) => animDef(id),
      actorOf: (uid) => this.actors.get(uid),
      tickMs: TUNING.tick.ms,
      onEvent: (ev, inAction) => this.applyEvent(ev, inAction)
    })
    // battle:start is already in battle.events; anything after it has not been played.
    this.player.enqueue(this.battle.events.slice(this.battle.events.indexOf(start) + 1))
    this.player.setSpeed(this.speed)

    // A lunging attacker can overlap its target, so a click picks from every sprite under the pointer.
    this.input.topOnly = false
    this.input.on('pointerdown', (p, over) => this.pick(over.map((o) => o.getData('uid'))))
    this.fit()
    this.scale.on('resize', this.fit, this)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.fit, this)
      this.tweens.timeScale = 1
      this.anims.globalTimeScale = 1
      this.anims.resumeAll()
    })
    this.cameras.main.fadeIn(180, 6, 5, 10)
    this.lastSecond = -1
    this.changed()
    this.args.onReady?.(this)
  }

  fit () {
    const { width, height } = this.scale
    const cam = this.cameras.main
    const bar = this.args.barHeight?.() || BAR_PX
    const zoom = Math.max(0.4, Math.min(1.5, (height - bar) / 640, width / 540))
    cam.setZoom(zoom)
    cam.centerOn(0, bar / 2 / zoom)
  }

  update (time, delta) {
    const b = this.battle
    if (!this.paused) {
      this.playMs += Math.min(delta, 250) * this.speed
      const want = Math.floor(this.playMs / TUNING.tick.ms)
      if (!b.over && b.t < want) this.player.enqueue(this.args.act({ type: 'advance', ticks: want - b.t }))
    }
    this.player.update(this.playMs)
    if (b.over && this.player.finished && !this.ending) this.finish()

    for (const a of this.actors.values()) {
      const y = a.sprite.y + 10
      a.barBg.setPosition(a.sprite.x, y + 2)
      a.bar.setPosition(a.sprite.x - BAR / 2, y)
      a.gaugeBar.setPosition(a.sprite.x - BAR / 2, y + 4)
      const u = this.units.get(a.uid)
      if (!a.gone && u.hp > 0) {
        const cost = viable(b, u)[0]?.ability.castCost ?? 100
        a.gaugeBar.width = BAR * Math.min(1, u.gauge / cost)
      }
    }
    const focus = b.focus && this.actors.get(b.focus.target)
    this.focusMark.setVisible(!!focus && !focus.gone)
    if (focus) this.focusMark.setPosition(focus.sprite.x, focus.sprite.y + 6)

    const second = Math.floor(b.t * TUNING.tick.ms / 1000)
    if (second !== this.lastSecond) {
      this.lastSecond = second
      this.changed()
    }
  }

  // ── controls (called by the DOM command bar) ─────────────────────────────────────────────────

  setSpeed (n) {
    this.speed = n
    this.player.setSpeed(n)
    this.changed()
  }

  setPaused (on) {
    if (this.ending) return
    this.paused = on
    if (on) { this.tweens.pauseAll(); this.anims.pauseAll() } else { this.tweens.resumeAll(); this.anims.resumeAll() }
    this.changed()
  }

  togglePause () {
    if (this.targeting) return this.cancelTarget()
    this.setPaused(!this.paused)
  }

  beginTarget (verb) {
    if (this.ending) return
    if (this.targeting?.verb === verb) return this.cancelTarget()
    const b = this.battle
    if (b.commandsLeft <= 0) return this.say('No Commands left this battle.')
    const wantFoe = verb === 'focus' || verb === 'parley'
    const ok = new Map()
    let reason = null
    for (const a of this.actors.values()) {
      const c = canIssue(b, verb, a.uid)
      if (c.ok) ok.set(a.uid, c)
      else if (!reason && !a.gone && (a.side === 'foe') === wantFoe) reason = c.reason
    }
    if (!ok.size) return this.say(`${VERB_NAME[verb]}: ${reason ?? 'no valid target'}.`)
    const wasPaused = this.targeting ? this.targeting.wasPaused : this.paused
    this.clearMarks()
    this.targeting = { verb, ok, wasPaused, marks: [] }
    for (const [uid, c] of ok) {
      const a = this.actors.get(uid)
      const ring = this.add.ellipse(a.sprite.x, a.sprite.y + 6, 52, 18).setStrokeStyle(2, 0xe8b04b, 1).setDepth(a.sprite.depth - 1)
      this.targeting.marks.push(ring)
      if (c.chance !== undefined) {
        this.targeting.marks.push(this.text(a.sprite.x, a.sprite.y - 52, `${Math.round(c.chance * 100)}%`, 13, '#e8b04b', 3)
          .setOrigin(0.5, 1).setDepth(9800))
      }
    }
    for (const a of this.actors.values()) if (!ok.has(a.uid) && !a.gone) a.sprite.setAlpha(0.45)
    this.message = `${VERB_NAME[verb]}: click a highlighted ${wantFoe ? 'foe' : 'ally'} · Esc cancels`
    this.setPaused(true)
  }

  cancelTarget (message = '') {
    if (!this.targeting) return
    const { wasPaused } = this.targeting
    this.clearMarks()
    this.targeting = null
    this.message = message
    this.setPaused(wasPaused)
  }

  clearMarks () {
    if (!this.targeting) return
    for (const m of this.targeting.marks) m.destroy()
    for (const a of this.actors.values()) if (!a.gone) a.sprite.setAlpha(1)
  }

  pick (uids) {
    if (!this.targeting || !uids.length) return
    const { verb, ok } = this.targeting
    const uid = uids.find((u) => ok.has(u))
    if (uid === undefined) return this.say('Not a valid target.')
    this.args.act({ type: 'command', verb, target: uid })
    this.cancelTarget(`${VERB_NAME[verb]} → ${unitDef(this.actors.get(uid).id).name}`)
  }

  say (message) {
    this.message = message
    this.changed()
  }

  changed () {
    const b = this.battle
    const h = this.hover != null && this.actors.get(this.hover)
    this.args.onChange?.({
      paused: this.paused,
      speed: this.speed,
      targeting: this.targeting?.verb ?? null,
      commandsLeft: b.commandsLeft,
      seconds: b.t * TUNING.tick.ms / 1000,
      over: this.ending,
      message: this.message,
      hover: h ? `${unitDef(h.id).name} · Lv ${this.units.get(h.uid).lvl} · HP ${h.hp}/${h.maxHp}` : ''
    })
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  posFor (side, slot) {
    const dir = side === 'party' ? 1 : -1
    return { x: (colOf(slot) - 1.5) * SPREAD, y: dir * (GAP + rowOf(slot) * DEPTH) }
  }

  addActor (u) {
    const home = this.posFor(u.side, u.slot)
    const art = unitDef(u.id).art
    const sprite = this.add.sprite(home.x, home.y, TEXTURE, `${art}/idle/0`)
      .setOrigin(0.5, 0.86).setScale(SCALE).setDepth(home.y)
    const idle = `${art}/idle`
    if (this.anims.exists(idle)) sprite.play(idle)
    const barBg = this.add.rectangle(home.x, home.y + 12, BAR + 2, 8, 0x07060b, 0.9).setDepth(9001)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 10, BAR * u.hp / u.maxHp, 3, u.side === 'party' ? 0x7be0a0 : 0xd05c5c)
      .setOrigin(0, 0.5).setDepth(9002)
    const gaugeBar = this.add.rectangle(home.x - BAR / 2, home.y + 14, 0, 2, 0xe8b04b).setOrigin(0, 0.5).setDepth(9002)
    const actor = { uid: u.uid, id: u.id, side: u.side, slot: u.slot, art, sprite, home, bar, barBg, gaugeBar, hp: u.hp, maxHp: u.maxHp, gone: false }
    sprite.on('animationcomplete', (anim) => {
      if (!actor.gone && anim.key !== idle && this.anims.exists(idle)) sprite.play(idle)
    })
    sprite.setInteractive({ useHandCursor: true }).setData('uid', u.uid)
    sprite.on('pointerover', () => { this.hover = u.uid; this.changed() })
    sprite.on('pointerout', () => { if (this.hover === u.uid) { this.hover = null; this.changed() } })
    this.actors.set(u.uid, actor)
  }

  decorate (start) {
    const bandW = 4 * SPREAD + 90
    const bandH = 2 * DEPTH + 110
    this.add.rectangle(0, 0, bandW + 200, 2, 0x1d1a2a, 0.7).setDepth(-500)
    for (const dir of [-1, 1]) {
      this.add.rectangle(0, dir * (GAP + DEPTH + 4), bandW, bandH, 0x121020, 0.55).setDepth(-400)
    }
    const occupied = new Set([...this.actors.values()].map((a) => `${a.side}/${a.slot}`))
    for (const side of ['party', 'foe']) {
      for (let slot = 0; slot < SLOTS; slot++) {
        const p = this.posFor(side, slot)
        this.add.ellipse(p.x, p.y + 8, 40, 12, side === 'party' ? 0x7be0a0 : 0xd05c5c, occupied.has(`${side}/${slot}`) ? 0.14 : 0.05)
          .setDepth(-350)
      }
    }
    const syn = (side) => start.synergies.filter((s) => s.side === side).map((s) => s.name).join(' · ')
    const label = (y, text, colour, size = 11) => this.text(-bandW / 2 + 8, y, text, size, colour)
      .setWordWrapWidth(bandW - 16).setDepth(-300)
    const top = -(GAP + 2 * DEPTH) - 74
    label(top - 4, this.args.title ?? `FLOOR ${this.battle.floor}`, '#d05c5c', 14)
    label(top + 14, syn('foe'), '#9a5a62', 12)
    label(GAP + 2 * DEPTH + 42, 'YOUR RETINUE', '#7be0a0', 14)
    label(GAP + 2 * DEPTH + 60, syn('party'), '#5ea878', 12)
  }

  // ── react to events the sim already decided ──────────────────────────────────────────────────

  applyEvent (ev, inAction) {
    const a = ev.target != null ? this.actors.get(ev.target) : null
    if (!a) return
    switch (ev.type) {
      case 'damage':
      case 'heal':
        a.hp = ev.hp
        a.bar.width = BAR * Math.max(0, a.hp / a.maxHp)
        if (ev.type === 'damage' && ev.damage > 0) this.flash(a)
        if (ev.type === 'heal' && !inAction && ev.heal > 0) this.floating(a, `+${ev.heal}`, '#7be0a0')
        break
      case 'death':
        a.gone = true
        a.gaugeBar.width = 0
        if (this.anims.exists(`${a.art}/faint`)) a.sprite.play(`${a.art}/faint`)
        // A unit can die mid-lunge; its return step is skipped once it is gone, so send it home now.
        this.tweens.add({ targets: a.sprite, alpha: 0.25, duration: 400 })
        this.tweens.add({ targets: [a.bar, a.barBg, a.gaugeBar], alpha: 0, duration: 300 })
        break
      case 'status':
        this.floating(a, statusDef(ev.status).name.toLowerCase(), '#b39ddb', 10)
        break
      case 'cleanse':
        this.pip(a, 0x7be0a0)
        break
      case 'gauge':
        this.pip(a, 0x66c8ff)
        break
      case 'miss':
        this.floating(a, 'miss', '#8e8e9e')
        break
      case 'persuade':
        if (!ev.success) this.floating(a, `${Math.round(ev.chance * 100)}% · refused`, '#b39ddb')
        break
      case 'recruit':
        a.gone = true
        this.floating(a, 'JOINS YOU', '#7be0a0', 13)
        this.tweens.add({ targets: [a.bar, a.barBg, a.gaugeBar], alpha: 0, duration: 300 })
        this.tweens.add({ targets: a.sprite, y: a.sprite.y - 26, alpha: 0, scale: SCALE * 1.2, duration: 620, ease: 'Quad.Out' })
        break
      case 'command':
        this.floating(a, VERB_NAME[ev.verb].toUpperCase(), '#e8b04b', 13)
        this.changed()
        break
      case 'refund':
        this.floating(a, 'parley refunded', '#8e8e9e')
        this.changed()
        break
      case 'move':
        a.slot = ev.slot
        a.home = this.posFor(a.side, ev.slot)
        a.sprite.setDepth(a.home.y)
        this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: 260, ease: 'Cubic.Out' })
        break
      case 'phase':
        this.floating(a, `PHASE ${ev.phase + 1}`, '#e06c6c', 15)
        this.cameras.main.shake(200, 0.006)
        break
    }
  }

  // Canvas text, smoothed: the game is pixelArt (nearest filtering), which garbles text at fractional zoom.
  text (x, y, str, size, colour, stroke = 0) {
    const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color: colour, stroke: '#07060b', strokeThickness: stroke })
      .setResolution(3)
    t.texture.setFilter(Phaser.Textures.FilterMode.LINEAR)
    return t
  }

  flash (a) {
    if (a.gone) return
    a.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(60 / this.speed, () => a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  pip (a, colour) {
    const dot = this.add.circle(a.sprite.x, a.sprite.y - 30, 2.5, colour).setDepth(9400)
    this.tweens.add({ targets: dot, y: dot.y - 12, alpha: 0, duration: 500, onComplete: () => dot.destroy() })
  }

  floating (a, text, colour, size = 11) {
    const t = this.text(a.sprite.x, a.sprite.y - 34, text, size, colour, 3).setOrigin(0.5, 1).setDepth(9500)
    this.tweens.add({ targets: t, y: t.y - 20, alpha: 0, duration: 760, ease: 'Quad.Out', onComplete: () => t.destroy() })
  }

  finish () {
    this.cancelTarget()
    this.setPaused(false)
    this.ending = true
    this.changed()
    const won = this.battle.winner === 'party'
    const plate = this.add.rectangle(0, 0, 4 * SPREAD + 300, 48, 0x07060b, 0.85).setDepth(9990).setAlpha(0)
    const banner = this.text(0, 0, won ? 'VICTORY' : this.battle.winner === 'foe' ? 'PARTY WIPED' : 'STALEMATE', 24, won ? '#7be0a0' : '#e06c6c', 4)
      .setOrigin(0.5).setDepth(10000).setAlpha(0)
    this.tweens.add({ targets: [plate, banner], alpha: 1, duration: 220 })
    this.time.delayedCall(1300, () => {
      this.cameras.main.fadeOut(220, 6, 5, 10)
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const done = this.args.onDone
        this.scene.stop()
        done?.()
      })
    })
  }
}

// ── timeline player ──────────────────────────────────────────────────────────────────────────────

// Sim events → tweens, anims and FX. The player only reads events; it never computes a result.
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
    this.scene.anims.globalTimeScale = n
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
    if (beat.action) this.onEvent?.(beat.action, true)
    for (const ev of beat.results) this.onEvent?.(ev, !!beat.action)
    if (!beat.action) return
    const tpl = beat.action.anim ? this.template(beat.action.anim) : null
    const actor = this.actorOf(beat.action.actor)
    if (!tpl || !actor) return
    const hit = beat.results.find((e) => e.type === 'damage' || e.type === 'heal' || e.type === 'persuade')
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
    const who = step.who === 'target' ? refs.primary : refs.actor
    if (!who || who.gone) return
    const key = `${who.art}/${step.key}`
    if (p.scene.anims.exists(key)) who.sprite.play(key, true)
  },

  tween (p, step, refs) {
    const who = step.who === 'target' ? refs.primary : refs.actor
    if (!who || who.gone) return
    const to = p.where(step.to, refs)
    p.scene.tweens.add({ targets: who.sprite, x: to.x, y: to.y, duration: step.dur ?? 150, ease: step.ease ?? 'Linear' })
  },

  fx (p, step, refs) {
    const at = p.where(step.at ?? 'target', refs)
    const ring = p.scene.add.circle(at.x, at.y, 6, tint(refs.beat.action.element), 0.85).setDepth(at.y + 40)
    p.scene.tweens.add({ targets: ring, scale: 3.2, alpha: 0, duration: 260, ease: 'Cubic.Out', onComplete: () => ring.destroy() })
  },

  projectile (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const bolt = p.scene.add.circle(from.x, from.y - 6, 3, tint(refs.beat.action.element), 1).setDepth(9000)
    p.scene.tweens.add({ targets: bolt, x: to.x, y: to.y - 6, duration: step.dur ?? 180, ease: 'Quad.In', onComplete: () => bolt.destroy() })
  },

  beam (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const line = p.scene.add.line(0, 0, from.x, from.y - 8, to.x, to.y - 8, tint(refs.beat.action.element))
      .setOrigin(0, 0).setLineWidth(1.5).setDepth(9000)
    p.scene.tweens.add({ targets: line, alpha: 0, duration: step.dur ?? 220, onComplete: () => line.destroy() })
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
      p.scene.floating(target, `${ev.type === 'heal' ? '+' : ''}${value}`,
        ev.type === 'heal' ? '#7be0a0' : ev.isCrit ? '#ffd28a' : '#f0e6d8', ev.isCrit ? 15 : 12)
    }
  }
}
