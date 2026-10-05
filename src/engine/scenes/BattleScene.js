// The battle screen: two facing 3×4 formations. The sim is stepped live, tick by tick, on the same
// clock that plays the events back; Commands are issued between ticks by clicking a sprite.
import Phaser from 'phaser'
import { TUNING, unitDef, statusDef, animDef } from '../../content/index.js'
import { stepBattle } from '../../sim/battle.js'
import { canIssue, issueCommand } from '../../sim/commands.js'
import { viable } from '../../sim/ai.js'
import { rowOf, colOf, SLOTS } from '../../sim/formation.js'
import { TimelinePlayer } from '../anim/TimelinePlayer.js'
import { TEXTURE } from './BootScene.js'

const GAP = 64        // centre line → each side's front row
const DEPTH = 74      // between rows
const SPREAD = 104    // between columns
const SCALE = 1.6
const BAR = 46
const BAR_PX = 72     // fallback height of the DOM command bar under the canvas
const FONT = 'ui-monospace, SFMono-Regular, Menlo, monospace'
const VERB_NAME = { focus: 'Focus', parley: 'Parley', brace: 'Brace', unleash: 'Unleash' }

export class BattleScene extends Phaser.Scene {
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
      while (!b.over && b.t < want) this.player.enqueue(stepBattle(b))
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

    const second = Math.floor(b.t / 20)
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
    const r = issueCommand(this.battle, { verb, target: uid })
    this.cancelTarget(r.ok ? `${VERB_NAME[verb]} → ${unitDef(this.actors.get(uid).id).name}` : r.reason)
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
      seconds: b.t / 20,
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
