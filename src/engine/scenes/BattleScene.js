// The battle screen: two 3×4 formations and a timeline being played back (§3, §8).
//
// The scene is a *player*, and nothing else. The battle was resolved before this scene existed —
// `sim/run.js` fought it the moment the leader stepped on the node — so `create()` is only:
//
//   1. build sprites from the battle:start event     ← the renderer reads the timeline
//   2. play the timeline back at whatever speed      ← and can never change the result
//
// At ×1 every event plays; at ×8 durations compress and non-essential FX are dropped; offline the
// scene is never constructed at all and the sim runs alone in a Worker.

import Phaser from 'phaser'
import { rowOf, colOf, SLOTS } from '../../sim/combat/formation.js'
import { tagSummary } from '../../sim/synergy.js'
import { TimelinePlayer } from '../anim/TimelinePlayer.js'

// The formations face each other vertically: your retinue holds the bottom half, the enemy the
// top, and both front rows meet at the centre line. Depth runs away from the middle, so a unit
// that is deeper in its formation is also further up (or down) the screen — the grid's shape is
// the screen's shape, which makes "who goes in front" legible without a legend.
const GAP = 64         // px from the centre line to each side's front row
const DEPTH = 74       // px between formation rows, running away from the centre
const SPREAD = 104     // px between formation columns, running across the screen
const SCALE = 1.6      // 48px sprites want presence on a battle screen
const BAR = 46

export class BattleScene extends Phaser.Scene {
  constructor () { super('Battle') }

  init (data) {
    this.args = data
  }

  create () {
    const { kernel, tuning } = this.registry.get('sim')
    const { result, floor, speed = 1, onDone } = this.args

    // The outcome arrived already decided. If this scene ever needs to compute one, the boundary
    // has broken and the fix is upstream, in `sim/run.js` — never here (§8).
    this.result = result
    this.floor = floor

    // ── 1. build the stage from the timeline's opening event ───────────────────────────────────
    this.cameras.main.setBackgroundColor('#0d0b13')
    this.actors = new Map()
    const opening = this.result.events[0]
    for (const u of opening.units) this.addActor(u)
    this.decorate()

    // ── 2. play it back ────────────────────────────────────────────────────────────────────────
    this.player = new TimelinePlayer(this, {
      template: (id) => kernel.registry.get('anim_template', id),
      actorOf: (uid) => this.actors.get(uid),
      tickMs: tuning.tick.ms,
      onEvent: (ev) => this.applyEvent(ev),
      onComplete: () => this.finish()
    })
    this.player.enqueue(this.result.events.slice(1))
    this.setSpeed(speed)

    this.input.keyboard.on('keydown', (e) => {
      const n = { Digit1: 1, Digit2: 2, Digit4: 4, Digit8: 8 }[e.code]
      if (n) this.setSpeed(n)
      if (e.code === 'Space') this.player.flush()
    })

    this.onDone = onDone
    this.cameras.main.fadeIn(180, 6, 5, 10)
  }

  setSpeed (n) {
    this.speed = n
    this.player.setSpeed(n)
    this.hud?.setText(this.hudText())
  }

  update (time, delta) {
    this.player?.update(delta)
    // Bars ride their sprite: a unit mid-lunge otherwise leaves its health bar standing at home,
    // which reads as a second, invisible unit.
    for (const a of this.actors.values()) {
      a.barBg.setPosition(a.sprite.x, a.sprite.y + 10)
      a.bar.setPosition(a.sprite.x - BAR / 2, a.sprite.y + 10)
    }
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  /** Party grows downward from the centre, foes upward. Row 0 is the front row on both sides. */
  posFor (side, slot) {
    const dir = side === 'party' ? 1 : -1
    return {
      x: this.scale.width / 2 + (colOf(slot) - 1.5) * SPREAD,
      y: this.scale.height / 2 + dir * (GAP + rowOf(slot) * DEPTH)
    }
  }

  addActor (u) {
    const home = this.posFor(u.side, u.slot)
    const texture = `${u.defId.split(':')[0]}:units`
    // No flip: the two sides face each other along the vertical axis, and our six clips have no
    // back view. Depth sorts by y, so a front-row unit correctly overlaps the one behind it.
    const sprite = this.add.sprite(home.x, home.y, texture, `${u.defId}/idle/0`)
      .setOrigin(0.5, 0.86)
      .setScale(SCALE)
      .setDepth(home.y)
    if (this.anims.exists(`${u.defId}/idle`)) sprite.play(`${u.defId}/idle`)

    const barBg = this.add.rectangle(home.x, home.y + 10, BAR + 2, 5, 0x07060b, 0.9).setDepth(home.y + 1)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 10, BAR, 3, u.side === 'party' ? 0x7be0a0 : 0xd05c5c)
      .setOrigin(0, 0.5).setDepth(home.y + 2)

    this.actors.set(u.uid, { ...u, sprite, home, bar, barBg, hp: u.hp, maxHp: u.maxHp, defId: u.defId })
  }

  decorate () {
    const { width, height } = this.scale
    const bandW = 4 * SPREAD + 90
    const bandH = 2 * DEPTH + 110

    this.add.rectangle(width / 2, height / 2, width, 2, 0x1d1a2a, 0.7).setDepth(-500)
    // A ground band per side, so the two formations read as facing each other rather than floating.
    for (const dir of [-1, 1]) {
      this.add.rectangle(width / 2, height / 2 + dir * (GAP + DEPTH + 4), bandW, bandH, 0x121020, 0.55)
        .setDepth(-400)
    }

    // All twelve slots are drawn on both sides, occupied or not. Position is a first-class
    // mechanic (§3) — a half-empty back row should look like a choice, not like a rendering gap.
    const occupied = new Set([...this.actors.values()].map((a) => `${a.side}/${a.slot}`))
    for (const side of ['party', 'foe']) {
      for (let slot = 0; slot < SLOTS; slot++) {
        const p = this.posFor(side, slot)
        const here = occupied.has(`${side}/${slot}`)
        this.add.ellipse(p.x, p.y + 8, 40, 12, side === 'party' ? 0x7be0a0 : 0xd05c5c, here ? 0.14 : 0.05)
          .setDepth(-350)
      }
    }

    const label = (y, text, colour, size = '11px') => this.add.text(width / 2 - bandW / 2 + 10, y, text, {
      fontFamily: 'ui-monospace, monospace', fontSize: size, color: colour
    }).setOrigin(0, 0).setResolution(2).setDepth(-300)

    const { kernel } = this.registry.get('sim')
    const tags = (side) => tagSummary(kernel.registry,
      this.result.state.units.filter((u) => u.side === side)).join(' · ') || 'no synergy'
    // Which synergies fired is read off the opening event, not recomputed — the renderer stays a
    // reader even for the trait engine. Only Pacts are named: a Resonance's name is its threshold,
    // so printing both lines says the same thing twice.
    const named = (side) => (this.result.events[0].synergies ?? [])
      .filter((s) => s.side === side && s.kind === 'pact')
      .map((s) => '◆ ' + s.name).join('   ')

    label(height / 2 - GAP - 2 * DEPTH - 62, `FLOOR ${this.args.floor}   ${tags('foe')}`, '#d05c5c')
    label(height / 2 - GAP - 2 * DEPTH - 46, named('foe'), '#7a4a52', '10px')
    label(height / 2 + GAP + 2 * DEPTH + 46, `YOUR RETINUE   ${tags('party')}`, '#7be0a0')
    label(height / 2 + GAP + 2 * DEPTH + 62, named('party'), '#4e8f68', '10px')

    this.hud = this.add.text(12, 10, this.hudText(), {
      fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: '#cfc9bd'
    }).setResolution(2).setDepth(10000)
    this.add.text(12, this.scale.height - 22, '1 2 4 8 — speed · space — skip to the end', {
      fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: '#6e6a63'
    }).setResolution(2).setDepth(10000)
  }

  hudText () {
    const f = this.args.floor
    // The hash is on screen on purpose: two runs of the same seed must show the same one (§10).
    return `BATTLE — floor ${f}   ×${this.speed ?? 1}   ${this.result.ticks} ticks ` +
      `(${(this.result.ticks / 20).toFixed(1)}s)   timeline ${this.result.hash}`
  }

  // ── the renderer's entire job: react to events it did not compute ─────────────────────────────

  applyEvent (ev) {
    const target = ev.target != null ? this.actors.get(ev.target) : null

    switch (ev.type) {
      case 'damage':
      case 'heal':
        if (!target) return
        target.hp = ev.hp                       // read, never recomputed
        target.bar.width = BAR * Math.max(0, target.hp / target.maxHp)
        if (ev.type === 'damage' && ev.damage > 0) this.flash(target)
        break

      case 'death':
        if (!target) return
        if (this.anims.exists(`${target.defId}/faint`)) target.sprite.play(`${target.defId}/faint`)
        this.tweens.add({ targets: [target.sprite], alpha: 0.25, duration: 400 })
        this.tweens.add({ targets: [target.bar, target.barBg], alpha: 0, duration: 300 })
        break

      case 'status':
        if (target) this.pip(target, 0x9b7be0)
        break

      case 'cleanse':
        if (target) this.pip(target, 0x7be0a0)
        break

      case 'miss':
        if (target) this.floating(target, 'miss', '#8e8e9e')
        break

      case 'persuade':
        if (target && !ev.success && ev.chance !== undefined) {
          this.floating(target, `${Math.round(ev.chance * 100)}% — no`, '#b39ddb')
        }
        break

      // The payoff shot of the whole acquisition loop, so it gets more than a pip.
      case 'recruit':
        if (!target) return
        this.floating(target, 'JOINS YOU', '#7be0a0')
        this.tweens.add({ targets: [target.bar, target.barBg], alpha: 0, duration: 300 })
        this.tweens.add({
          targets: target.sprite,
          y: target.sprite.y - 26,
          alpha: 0,
          scale: SCALE * 1.2,
          duration: 620,
          ease: 'Quad.Out'
        })
        break
    }
  }

  flash (actor) {
    // v3's setTintFill is gone in v4 — tint plus an explicit tint mode replaces it.
    actor.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL)
    this.time.delayedCall(60 / this.speed, () => actor.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  pip (actor, colour) {
    const dot = this.add.circle(actor.sprite.x, actor.sprite.y - 30, 2.5, colour).setDepth(9400)
    this.tweens.add({ targets: dot, y: dot.y - 12, alpha: 0, duration: 500, onComplete: () => dot.destroy() })
  }

  floating (actor, text, colour) {
    const t = this.add.text(actor.sprite.x, actor.sprite.y - 34, text, {
      fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: colour, stroke: '#07060b', strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(9500).setResolution(3)
    this.tweens.add({ targets: t, y: t.y - 16, alpha: 0, duration: 600, onComplete: () => t.destroy() })
  }

  finish () {
    const won = this.result.state.winner === 'party'
    // The centre line is the one strip of the screen no unit ever stands on.
    const plate = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, 44, 0x07060b, 0.8)
      .setDepth(9990).setAlpha(0)
    const banner = this.add.text(this.scale.width / 2, this.scale.height / 2,
      won ? 'VICTORY' : this.result.state.winner === 'foe' ? 'PARTY WIPED' : 'STALEMATE', {
        fontFamily: 'ui-monospace, monospace', fontSize: '22px',
        color: won ? '#7be0a0' : '#e06c6c', stroke: '#07060b', strokeThickness: 4
      }).setOrigin(0.5).setDepth(10000).setResolution(2).setAlpha(0)

    this.tweens.add({ targets: [plate, banner], alpha: 1, duration: 220 })
    this.time.delayedCall(900 / this.speed, () => {
      this.cameras.main.fadeOut(220, 6, 5, 10)
      this.cameras.main.once('camerafadeoutcomplete', () => {
        const done = this.onDone
        this.scene.stop()
        done?.(this.result)
      })
    })
  }
}
