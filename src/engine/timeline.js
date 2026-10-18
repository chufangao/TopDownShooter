// The timeline player: sim events, an order's at a time, turned into tweens, poses and FX by beat.
import Phaser from '../vendor/phaser.js'
import { abilityDef } from '../content.js'

// ── timeline player ──────────────────────────────────────────────────────────────────────────────

// The player only reads events; it never computes a result. Events come an order at a time, stamped with a beat, and
// each beat plays once the one before has had its time (spanOf), never before now: the playhead is the scene's clock.

export const STEP_MS = 190     // a tile of a move's path
const ECHO_MS = 260     // an Echo's second pass lands this long after the first

export class TimelinePlayer {
  constructor (scene, { template, actorOf, onEvent = null }) {
    this.scene = scene
    this.template = template
    this.actorOf = actorOf
    this.onEvent = onEvent
    // When the last beat began (tail), how long it takes (span), and its index (last).
    this.tail = 0
    this.span = 0
    this.last = null
    this.playhead = 0
    this.queue = []       // beats: { at, action, results }
    this.cursor = 0
    this.scheduled = []   // { at, run }
    this.warned = new Set()
    this.seq = new WeakMap() // event → its place in the stream, so a late-shown result never undoes a newer one
    this.count = 0
  }

  // An `action` owns the events that follow it in its beat; one order's events end its beats, so none spans two calls.
  enqueue (events) {
    let beat = null
    for (const ev of events) {
      this.seq.set(ev, this.count++)
      const at = this.slot(ev)
      if (ev.type === 'action') {
        beat = { at, action: ev, results: [] }
        this.queue.push(beat)
      } else if (beat && ev.beat === beat.action.beat) {
        beat.results.push(ev)
      } else {
        this.queue.push({ at, action: null, results: [ev] })
        beat = null
      }
    }
  }

  // When `ev` plays (its beat's start): each beat after the last has had its span, and none before now.
  slot (ev) {
    if (ev.beat !== this.last) {
      this.tail = Math.max(this.tail + this.span, this.playhead)
      this.span = 0
      this.last = ev.beat
    }
    this.span = Math.max(this.span, spanOf(ev, this.template))
    return this.tail
  }

  // The last beat's end: the playhead skips ahead to it, and every beat queued plays now (Skip).
  get end () {
    return this.tail + this.span
  }

  // Every beat played, the last one's time run too.
  get finished () {
    return this.cursor >= this.queue.length && this.scheduled.length === 0 && this.playhead >= this.tail + this.span
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
    const impact = tpl?.steps.find((s) => s.op === 'popup')?.t ?? 0
    beat.results.forEach((ev, i) => {
      const run = () => this.onEvent?.(ev, !!beat.action, this.seq.get(ev))
      // A move, a shadow rising and a unit entering play at once, as their beat begins; an Echo's second pass a moment later.
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

// How long a beat takes once begun, by its longest event (playhead ms): an action its animation's, a move STEP_MS a
// tile, the rest what their pictures need to read.
function spanOf (ev, template) {
  switch (ev.type) {
    case 'action': return ev.anim ? template(ev.anim).dur ?? 600 : 300
    case 'move': return (ev.path?.length ?? 1) * STEP_MS + 60
    case 'undo': return STEP_MS + 60
    case 'stage': return ev.stage === 'foes' ? 650 : 120
    case 'turn': return 300
    case 'wave': return 900
    case 'enter': return 600
    case 'arise': return 1100
    case 'death': return 450
    case 'hexed': return 500
    default: return 100
  }
}

// How much later than its beat result `i` shows: ECHO_MS for an Echo's second pass (the results after its `rule` event).
function echoed (beat, i) {
  const at = beat.results.findIndex((e) => e.type === 'rule' && e.rule === 'echo')
  return at >= 0 && i > at ? ECHO_MS : 0
}

// An ability's colour, for its bolts, beams and hit sparks.
export const tint = (ability) => parseInt((ability ? abilityDef(ability).tint : '#d8d4cc').slice(1), 16)

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
    const flip = refs.beat.action.beat % 2 ? 1 : -1
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

  // A template shakes only when it says `always`; the heavy blows shake through their events instead.
  shake (p, step) {
    if (step.always) p.scene.shake(step.dur ?? 120, (step.mag ?? 4) / 900)
  },

  // The numbers on screen are read off the sim's events; an Echo's second pass pops up a beat later.
  popup (p, step, refs) {
    refs.beat.results.forEach((ev, i) => {
      if (ev.type !== 'damage' && ev.type !== 'heal') return
      const value = ev.type === 'heal' ? ev.heal : ev.damage
      const target = p.actorOf(ev.target)
      if (!value || !target) return
      const run = () => p.scene.floating(target, `${ev.type === 'heal' ? '+' : ''}${value}`, ev.type === 'heal' ? '#7be0a0' : '#f4ece0', 13)
      const late = echoed(refs.beat, i)
      if (late) p.scheduled.push({ at: p.playhead + late, run })
      else run()
    })
  }
}
