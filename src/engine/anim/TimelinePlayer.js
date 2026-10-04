// Sim events → tweens, anims and FX (§7, §8).
//
//   const { state, events } = resolveTick(state, rng, ctx)   // pure, already decided
//   timelinePlayer.enqueue(events)                           // rendering only
//
// The contract runs one way. This file reads `event.damage`; it never computes it. Everything
// expressive is a shared, data-defined attack template loaded from packs/ — any unit references a
// template by id, and templates are reused across the whole roster.
//
// One deliberate asymmetry (§13.4): an unknown *sim* op is a hard error at load, but an unknown
// *animation step* op is skipped with a single warning. The sim must never run content it does not
// understand; the renderer must never take the game down over a cosmetic.

const ESSENTIAL = new Set(['anim', 'popup', 'tween'])

export class TimelinePlayer {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} deps
   * @param {(id: string) => object} deps.template  anim_template lookup, from the registry
   * @param {(uid: number) => object} deps.actorOf  uid → {sprite, home, defId, …}
   * @param {number} deps.tickMs                    tuning.tick.ms — the sim's tick, in ms
   */
  constructor (scene, { template, actorOf, tickMs = 50, onEvent = null, onComplete = null }) {
    this.scene = scene
    this.template = template
    this.actorOf = actorOf
    this.tickMs = tickMs
    this.onEvent = onEvent
    this.onComplete = onComplete

    this.playhead = 0
    this.speed = 1
    this.queue = []        // [{ at, action, results }]
    this.cursor = 0
    this.scheduled = []    // [{ at, run }]
    this.warned = new Set()
    this.done = false
  }

  /**
   * Group the timeline into playable beats. An `action` owns every event that follows it on the
   * same tick, which is how a template's `popup src: event.damage` finds its number.
   */
  enqueue (events) {
    let beat = null
    for (const ev of events) {
      const at = ev.t * this.tickMs
      if (ev.type === 'action') {
        beat = { at, action: ev, results: [] }
        this.queue.push(beat)
      } else if (beat && ev.t === beat.action.t && !beat.action.done) {
        beat.results.push(ev)
      } else {
        this.queue.push({ at, action: null, results: [ev] })
        beat = null
      }
    }
    this.queue.sort((a, b) => a.at - b.at)
    return this
  }

  setSpeed (n) {
    this.speed = n
    this.scene.tweens.timeScale = n
    this.scene.anims.globalTimeScale = n
  }

  get finished () {
    return this.cursor >= this.queue.length && this.scheduled.length === 0
  }

  /** The playback clock, decoupled from the sim clock (§8). */
  update (delta) {
    if (this.done) return
    this.playhead += delta * this.speed

    while (this.cursor < this.queue.length && this.queue[this.cursor].at <= this.playhead) {
      this.play(this.queue[this.cursor++])
    }

    // Own scheduler rather than scene.time, so one clock drives beats, steps and tween scaling.
    for (let i = 0; i < this.scheduled.length; i++) {
      if (this.scheduled[i].at > this.playhead) continue
      const { run } = this.scheduled[i]
      this.scheduled.splice(i--, 1)
      run()
    }

    if (!this.done && this.finished) {
      this.done = true
      this.onComplete?.()
    }
  }

  /** Skip everything remaining — used when the player cranks the speed past playback. */
  flush () {
    while (this.cursor < this.queue.length) this.play(this.queue[this.cursor++], true)
    for (const s of this.scheduled.splice(0)) s.run()
  }

  play (beat, instant = false) {
    for (const ev of beat.results) this.onEvent?.(ev)
    if (!beat.action) return

    this.onEvent?.(beat.action)
    const tpl = beat.action.anim ? this.template(beat.action.anim) : null
    if (!tpl) return

    const actor = this.actorOf(beat.action.actor)
    const damage = beat.results.find((e) => e.type === 'damage')
    const primary = this.actorOf((damage ?? beat.results[0])?.target ?? beat.action.targets?.[0])
    if (!actor) return

    for (const step of tpl.steps) {
      // At ×4 and above the compressed durations make FX unreadable anyway, so drop everything
      // that is not load-bearing rather than rendering a smear.
      if (this.speed >= 4 && !ESSENTIAL.has(step.op)) continue
      const at = this.playhead + step.t
      const run = () => this.runStep(step, { actor, primary, beat, damage })
      if (instant || step.t === 0) run()
      else this.scheduled.push({ at, run })
    }
  }

  runStep (step, refs) {
    const fn = STEPS[step.op]
    if (!fn) {
      if (!this.warned.has(step.op)) {
        this.warned.add(step.op)
        console.warn(`anim step op "${step.op}" is unknown — skipping it and carrying on`)
      }
      return
    }
    try {
      fn(this, step, refs)
    } catch (e) {
      console.warn(`anim step "${step.op}" failed:`, e.message)
    }
  }

  /** Resolve a template's symbolic position into world coordinates. */
  where (name, { actor, primary }) {
    switch (name) {
      case 'actor': return { x: actor.sprite.x, y: actor.sprite.y }
      case 'home': return { ...actor.home }
      case 'target': return primary ? { x: primary.sprite.x, y: primary.sprite.y } : { ...actor.home }
      case 'targetAdj': {
        // Stop short of the target along whatever axis the two formations happen to face. Keeping
        // this a vector rather than an x-offset is what let the battle layout rotate from
        // side-by-side to top-and-bottom without touching a single template.
        if (!primary) return { ...actor.home }
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

/**
 * The animation step vocabulary. Adding one is a function here plus its name in a template — the
 * same shape as adding a sim op, with the opposite failure policy.
 */
const STEPS = {
  anim (p, step, refs) {
    const who = step.who === 'target' ? refs.primary : refs.actor
    const key = `${who?.defId}/${step.key}`
    if (who && p.scene.anims.exists(key)) who.sprite.play(key, true)
  },

  tween (p, step, refs) {
    const who = step.who === 'target' ? refs.primary : refs.actor
    if (!who) return
    const to = p.where(step.to, refs)
    p.scene.tweens.add({ targets: who.sprite, x: to.x, y: to.y, duration: step.dur ?? 150, ease: step.ease ?? 'Linear' })
  },

  fx (p, step, refs) {
    const at = p.where(step.at ?? 'target', refs)
    const ring = p.scene.add.circle(at.x, at.y, 6, tint(refs.beat.action.element), 0.85).setDepth(at.y + 40)
    p.scene.tweens.add({
      targets: ring, scale: 3.2, alpha: 0, duration: 260, ease: 'Cubic.Out', onComplete: () => ring.destroy()
    })
  },

  projectile (p, step, refs) {
    const from = p.where(step.from ?? 'actor', refs)
    const to = p.where(step.to ?? 'target', refs)
    const bolt = p.scene.add.circle(from.x, from.y - 6, 3, tint(refs.beat.action.element), 1).setDepth(9000)
    p.scene.tweens.add({
      targets: bolt, x: to.x, y: to.y - 6, duration: step.dur ?? 180, ease: 'Quad.In', onComplete: () => bolt.destroy()
    })
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

  /**
   * The whole architecture in one function: the number on screen is read off the event the sim
   * already computed. If this ever calls a formula, the boundary has broken.
   */
  popup (p, step, refs) {
    const ev = refs.damage ?? refs.beat.results.find((e) => e.heal !== undefined)
    if (!ev) return
    const target = p.actorOf(ev.target)
    if (!target) return

    const heal = ev.heal !== undefined
    const value = heal ? ev.heal : ev.damage
    if (!value) return

    const text = p.scene.add.text(target.sprite.x, target.sprite.y - 34, `${heal ? '+' : ''}${value}`, {
      fontFamily: 'ui-monospace, monospace',
      fontSize: ev.isCrit ? '15px' : '12px',
      color: heal ? '#7be0a0' : ev.isCrit ? '#ffd28a' : '#f0e6d8',
      stroke: '#07060b',
      strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(9500).setResolution(3)

    p.scene.tweens.add({
      targets: text, y: text.y - 22, alpha: { from: 1, to: 0 }, duration: 700, ease: 'Quad.Out', onComplete: () => text.destroy()
    })
  }
}

const ELEMENT_TINT = {
  'core:physical': 0xd8d4cc,
  'core:fire': 0xff7a33,
  'core:frost': 0x66c8ff,
  'core:arcane': 0xb57bff,
  'core:dark': 0x9a7bc8,
  'core:holy': 0xffe9a8
}
const tint = (element) => ELEMENT_TINT[element] ?? 0xd8d4cc
