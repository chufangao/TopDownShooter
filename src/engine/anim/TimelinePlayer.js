// Sim events → tweens, anims and FX. The player only reads events; it never computes a result.
// Events are appended as the battle steps (always in tick order) and played when the playhead,
// which the scene drives with the same clock as the sim, reaches their tick.
import { ELEMENTS } from '../../content/index.js'

const ESSENTIAL = new Set(['anim', 'popup', 'tween'])

export class TimelinePlayer {
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
