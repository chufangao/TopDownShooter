// The battle scene: the board a battle plays on, the player's taps as orders, and their events played back.
import Phaser from '../vendor/phaser.js'
import { TUNING } from '../tuning.js'
import { unitDef, statusDef, animDef, abilityDef, relicDef, SYNERGIES, ROLES } from '../content.js'
import {
  reach, targetsFrom, preview, canAct, usable, isSkill, hexed, orderable, endable, nextWave, holds, synergiesOf, ariseOf,
  lined, lineOf, lineStruck, stats, untouchedPreview
} from '../sim/turns.js'
import { foeEssence, eliteBonus } from '../sim/run.js'
import { threatOf } from '../sim/foe.js'
import { tileX, tileY, tileAt, LANES, DEPTH, TILES, ROWS, CAMP_ROWS, distance, rangeOf, blowReach, footprint, alive, isBlow, synergyWeight } from '../sim/unit.js'
import { sfx } from '../sfx.js'
import { hold, touchy, FEET } from '../dom.js'
import { synergyLabels, summonedBy, ruleFlares } from '../codex.js'
import {
  hex, C, PARTY, FOE, SOUL, GOLD, CROWN, DOMAIN, RISE, UNDYING, BOON, PLAN, INK, PANEL, NEUTRAL, palette, labelPx, labelScale, labelSize,
  legible, FONT, DISPLAY
} from './palette.js'
import { RES, WALLS, WALL_FOOT, shadeTextures, artOf } from './textures.js'
import { BAR, BAR_DROP, growthMarks } from './marks.js'
import {
  TILE_W, TILE_H, HALF_W, HALF_H, posOf, posAt, BIG, HOVER, BOB, SHARE, tileUnder, offBoard, cellsBox, BOX, facesLeft, fitBox, ringBox,
  lineOfFire, REACH, STUDY, inked, paintReach, envelope, dashedEllipse, actReach, drawGround
} from './geometry.js'
import { STEP_MS, TimelinePlayer, tint } from './timeline.js'

// ── battle scene ─────────────────────────────────────────────────────────────────────────────────

// The battle screen: your walled camp on the right, the foes on the left. Pause and skip change only the playback.

// A skill's cooldown pip under a piece's bars: lit (the Monarch's gold) once ready, `rest` while it rests.
const PIP = { w: 7, h: 4, step: 9, rest: 0x3a3258 }
// A tap moves no more than this (CSS px) between press and release.
const TAP_SLOP = 10
export const SCALE = 0.95      // world px per unit of a picture's viewBox
export const WALL_SCALE = 1
export const BREATH = 0.014    // idle breathing: the share of its height a unit swells by
const REST = { lean: 0, sx: 0, sy: 0, dx: 0, dy: 0 } // a unit's pose at rest
const TITHE = '#ff6a8a'  // the HP Blood Tithe takes from the Monarch
const SHADE_ALPHA = 0.8 // a shadow is see-through
const HEX = 0x9b5cff     // Hexed: the violet pall over the hexed
const FLOAT_ROWS = 4    // popups over one unit stack this many rows high at once
// ms a popup holds its row; one that comes sooner takes a row above it, or waits for one.
const FLOAT_HOLD = 520
// A status's name rises in a column of its own beside the unit (floating, `side`), never over the numbers.
const SIDE_ROW = 13
const HIT_WASH = 0x8c8c8c // a blow's flash: screened over the struck, about half way to white
const ROT = 0xd88ab8   // the Sovereign's Grave Tide: the glow its shadows rise in, on the foes' side
const ORDINAL = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH']
// Reduced motion, followed as it changes: no shake or flash, no hit-stop, breathing or pops; essence lands at once.
const motion = typeof matchMedia === 'undefined' ? null : matchMedia('(prefers-reduced-motion: reduce)')
let calm = !!motion?.matches
motion?.addEventListener?.('change', (e) => { calm = e.matches })
export const reducedMotion = () => calm

// The rules at work that flare, by rule; RULE_ON: those whose name rises on the unit it acts through, not its target.
const RULES = ruleFlares()
const RULE_ON = {
  frenzy: 'actor', echo: 'actor', bodyguard: 'actor', sanctuary: 'actor', dragonfire: 'actor', deadeye: 'actor', deathblow: 'actor',
  charnel_cathedral: 'actor', cinder_wyrm: 'actor', hive_mind: 'actor', barrow_marshal: 'actor', swarm_queen: 'actor'
}
// Rules that strike on almost every cast: their name rises at most once a NOISY_MS per side.
const NOISY = new Set(['sanctuary', 'echo', 'dragonfire', 'deadeye'])
const NOISY_MS = 1000

export class BattleScene extends Phaser.Scene {
  constructor () { super('Battle') }

  init (data) {
    this.args = data
    this.battle = data.battle
    // No clock: the playback runs on its own time, and between orders the board waits for the player. `sel`: the piece
    // selected ({ uid, ability (armed), aim (previewed), reach (its Move range), targets }); `waiting`: an order's events
    // still playing (input locked); `counts`: the turn and waves as the playback last announced them (the sim runs ahead).
    this.paused = false
    this.playMs = 0
    this.sel = null
    // A met foe tapped: its reach is drawn until the next tap elsewhere.
    this.studied = null
    this.waiting = false
    this.counts = { turn: this.battle.turn, next: nextWave(this.battle), wave: 1 }
    this.synKey = null
    this.ending = false
    this.hover = null
    // The end's replay beat (finish), drawn each frame once the battle is lost.
    this.endBeat = null
    this.endG = null
    this.small = [] // labels kept legible as the camera zooms (fit)
    this.announced = new Set() // `side|rule`: the rules already named this battle
    this.noisy = new Map() // `side|rule` → playMs its name last rose, for the NOISY rules
    // On this battle's clock: the Monarch's last shake, and the last wave-paid popup and its stack (wavePaid).
    this.monarchShook = -Infinity
    this.payAt = -1e9
    this.payStack = 0
  }

  create () {
    palette()
    this.actors = new Map()
    this.units = new Map(this.battle.units.map((u) => [u.uid, u]))
    this.emitters = new Map()
    const start = this.battle.events.find((e) => e.type === 'battle:start')
    // The Monarch's uid (null in a battle without one).
    this.monarch = start.monarch
    // The foes by wave (0: the board's formation): each one's `size` for its banner, `left` standing for its pay.
    const foes = [...start.units.filter((u) => u.side === 'foe'), ...(start.reserve ?? []).filter((r) => r.side === 'foe')]
    this.waves = []
    for (const f of foes) {
      const w = (this.waves[f.wave ?? 0] ??= { size: 0, left: 0, paid: 0, shown: false, when: f.when ?? null, boss: null })
      w.size++
      w.left++
      if (unitDef(f.id).boss) w.boss = f.id
    }
    this.essence = this.args.essence ?? 1
    // Essence carried, counted as each orb reaches the bar (pay); the hit-stop's hold; whether the opening sound played.
    this.purse = 0
    this.owed = 0
    this.stopUntil = 0
    this.begun = false
    this.crumbling = false
    this.holdUntil = 0
    this.decorate(start)
    for (const u of start.units) this.addActor(u)
    this.flames = this.add.particles(0, 0, 'spark', {
      emitting: false, lifespan: 460, speedY: { min: -85, max: -35 }, speedX: { min: -12, max: 12 },
      scale: { start: 0.9, end: 0.1 }, alpha: { start: 0.95, end: 0 }, tint: [0xffe08a, 0xffa040, 0xff5a1e], blendMode: 'ADD'
    }).setDepth(9150)
    this.dust = this.add.particles(0, 0, 'glow', {
      emitting: false, lifespan: 650, speedX: { min: -120, max: 120 }, speedY: { min: -40, max: -5 }, gravityY: 70,
      scale: { start: 0.32, end: 0.08 }, alpha: { start: 0.45, end: 0 }, tint: [0x6e6680, 0x8a8094, 0x544c64]
    }).setDepth(9100)

    this.player = new TimelinePlayer(this, {
      template: (id) => animDef(id),
      actorOf: (uid) => this.actors.get(uid),
      onEvent: (ev, inAction, seq) => this.applyEvent(ev, inAction, seq)
    })
    // The selection's light under the units (plan); an aimed ranged blow's line of fire over them (shotG).
    this.planG = this.add.graphics().setDepth(-390)
    this.shotG = this.add.graphics().setDepth(9600)
    this.aimMarks = []
    // The aimed target's lock-on; the mouse over the board (null off it or by touch); the selected piece's Move ghost.
    this.lock = []
    this.pointer = null
    this.ghost = { tile: null, img: null }
    // battle:start is already in battle.events; anything after it has not been played.
    this.player.enqueue(this.battle.events.slice(this.battle.events.indexOf(start) + 1))
    // A saved battle resumed: its orders play again at once, unheard and out of sight; the board fades in after.
    this.resuming = !!this.args.resume
    if (this.resuming) {
      calm = true
      sfx.quiet = true
      this.cameras.main.setAlpha(0)
      this.flush()
    }

    this.fit()
    this.scale.on('resize', this.fit, this)
    // A tap gives orders; by touch a unit's card comes by a long press, pinned, and a mouse reads it on the hover.
    const canvas = this.game.canvas
    const press = (e) => this.down(e)
    const point = (e) => this.point(e)
    canvas.addEventListener('pointerdown', press)
    canvas.addEventListener('pointermove', point)
    canvas.addEventListener('pointerleave', point)
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.fit, this)
      canvas.removeEventListener('pointerdown', press)
      canvas.removeEventListener('pointermove', point)
      canvas.removeEventListener('pointerleave', point)
      this.dropMarks()
      this.dropGhost()
      if (this.resuming) { calm = !!motion?.matches; sfx.quiet = false }
      this.tweens.timeScale = 1
      this.args.onHover?.(null)
    })
    // From prep the board fades into it instead: the units already stand where they will start.
    if (!this.args.seamless && !this.resuming) this.cameras.main.fadeIn(260, 6, 5, 10)
    // The opening (the first turn's announcement) plays before the board takes orders.
    this.waiting = true
    this.changed()
    this.args.onReady?.(this)
  }

  // The camera onto the board inside the page's stage (args.stage(), a viewport rect), as large as it fits.
  fit () {
    const cam = this.cameras.main
    const c = this.game.canvas.getBoundingClientRect()
    const r = this.args.stage?.() ?? c
    if (!r.width || !r.height) return
    const v = fitBox(r, BOX)
    cam.setViewport(0, 0, Math.round(c.width), Math.round(c.height))
    cam.setZoom(v.z)
    cam.centerOn(v.wx - (v.sx - c.left - cam.width / 2) / v.z, v.wy - (v.sy - c.top - cam.height / 2) / v.z)
    for (const t of this.small ?? []) legible(t, v.z)
  }

  update (time, delta) {
    const b = this.battle
    const held = this.stopUntil > time
    if (this.stopUntil && !held) { this.stopUntil = 0; this.tweens.timeScale = 1 }
    if (!this.paused && !held) {
      if (!this.begun) { this.begun = true; sfx.play('begin') }
      this.playMs += Math.min(delta, 250)
    }
    this.player.update(this.playMs)
    if (this.resuming && this.player.finished) {
      this.resuming = false
      calm = !!motion?.matches
      sfx.quiet = false
      this.tweens.add({ targets: this.cameras.main, alpha: 1, duration: 320, ease: 'Sine.Out' })
    }
    if (this.waiting && this.player.finished && !b.over) {
      this.waiting = false
      this.settle()
    }
    // The end waits for the crumble to play out.
    if (b.over && this.player.finished && !this.ending && this.playMs >= this.holdUntil) this.finish()

    // The tiles the living hold in the air and on the ground (a 2×2 all four), for who shares one (SHARE).
    const air = new Set()
    const ground = new Set()
    for (const a of this.actors.values()) if (!a.gone) for (const t of footprint(a.tile, a.fp) ?? [a.tile]) (a.fly ? air : ground).add(t)
    for (const a of this.actors.values()) {
      const mate = !a.gone && (a.fly ? ground.has(a.tile) : a.fp === 1 && air.has(a.tile))
      a.share += ((mate ? 1 : 0) - a.share) * (calm ? 1 : Math.min(1, delta / SHARE.ms))
      const sx = (a.fly ? 1 : -1) * SHARE.x * a.share
      a.up = a.fly ? SHARE.up * a.share : 0
      const k = 1 - (1 - SHARE.bar) * a.share
      const x = a.vx = a.sprite.x + sx
      const y = a.sprite.y + BAR_DROP
      // The pose and breathing keep the playback clock, so pause holds them; the pose's dx, dy move the picture off its feet.
      const p = a.pose
      const breath = a.gone || calm ? 0 : BREATH * Math.sin(this.playMs / 640 + a.uid)
      a.sprite.setScale(a.scale * (1 + p.sx), a.scale * (1 + p.sy + breath))
      a.sprite.angle = p.lean
      // A flyer floats a.hover over its shadow, bobbing; its bars and shadow stay on the ground.
      const bob = a.hover && !calm ? BOB * Math.sin(this.playMs / 420 + a.uid) * a.hover / HOVER : 0
      a.sprite.setOrigin(0.5 - (p.dx + sx) / a.sprite.displayWidth, FEET - (p.dy - a.hover - a.up - bob) / a.sprite.displayHeight)
      // The dead lie under the living who step over them; a flyer over whoever shares its row.
      a.sprite.setDepth(a.gone ? a.sprite.y - TILE_H / 2 : a.sprite.y + (a.hover ? 1 : 0))
      a.shadow.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 2)
      a.ring.setPosition(x, a.sprite.y + 4).setDepth(a.sprite.y - 1)
      // The bars lie on the ground under the feet, sorted with the units, so they never cover a picture.
      const foot = a.sprite.y + 0.5
      a.barBg.setPosition(x, y + 2).setScale(k, 1).setDepth(foot)
      a.trail.setPosition(x - BAR * k / 2, y).setScale(k, 1).setDepth(foot + 0.1)
      a.bar.setPosition(x - BAR * k / 2, y).setScale(k, 1).setDepth(foot + 0.2)
      a.pips?.forEach((p, i) => p.setPosition(x - BAR * k / 2 + i * PIP.step * k, y + 7).setScale(k, 1).setDepth(foot + 0.2))
      a.growth?.place(x, a.sprite.y)
      a.sprite.setAlpha(a.fade * a.rise.v * (a.shade ? SHADE_ALPHA : 1))
      this.wear(a)
      // A skill's cooldown pip, as the playback has reached it (a.cd), so End Turn's ticking shows when it plays.
      if (a.pips && !a.gone) a.skills.forEach((id, i) => a.pips[i].setFillStyle(a.cd[id] > 0 ? PIP.rest : GOLD, a.cd[id] > 0 ? 0.9 : 1))
    }

    this.drawEnd(time)
  }

  // ── controls (called by the DOM playback bar) ────────────────────────────────────────────────

  setPaused (on) {
    if (this.ending) return
    this.paused = on
    if (on) this.tweens.pauseAll()
    else this.tweens.resumeAll()
    // The hover preview waits out a pause (pointedAt): gone with it, back after.
    if (!this.locked()) this.plan()
    this.changed()
  }

  togglePause () {
    this.setPaused(!this.paused)
  }

  // Leave now, once the battle is over and its banner up; until then Skip only hurries the playback (flush).
  skip () {
    if (!this.ending) return this.flush()
    const done = this.args.onDone
    if (!done) return
    this.args.onDone = null
    this.scene.stop()
    done()
  }

  // What the chrome shows (turn, waves, purse, busy, panel; synergies sent only on change), read once the playback has
  // played out, since the sim runs a whole order ahead: a fall never shows before it is seen. `roster`: null while busy.
  changed () {
    const b = this.battle
    const c = this.counts
    const free = !this.locked() && !this.ending
    if (this.synKey === null || free || this.ending) {
      const syn = (side) => synergyLabels(synergiesOf(b, side)).map((x) => ({ ...x, members: this.members(side, x.id) }))
      const now = { theirs: syn('foe'), mine: syn('party') }
      const key = JSON.stringify(now)
      if (key !== this.synKey) { this.synKey = key; this.args.hud?.synergies?.(now) }
    }
    this.args.onChange?.({
      paused: this.paused, over: this.ending, essence: this.purse,
      turn: c.turn, next: c.next && { ...c.next, size: this.waves[c.next.wave]?.size ?? null }, wave: c.wave, waves: Math.max(c.wave, this.waves.length),
      busy: this.locked(), panel: this.panel(), roster: free ? this.roster() : null
    })
  }

  // Your pieces that take orders (never the Monarch or the shadows) and the names of those that may still act.
  roster () {
    const b = this.battle
    const mine = b.units.filter((u) => orderable(b, u))
    return { total: mine.length, ready: mine.filter((u) => canAct(b, u)).map((u) => unitDef(u.id).name) }
  }

  // The living of `side` that synergy `id` counts, for its chip: each kind once (×n, a trine as three), shadows counted.
  members (side, id) {
    const b = this.battle
    const syn = SYNERGIES.find((s) => s.id === id)
    if (!syn) return ''
    const needs = Object.entries(syn.needs).flatMap(([axis, m]) => Object.keys(m).map((k) => [axis, k]))
    const counted = (u) => {
      const d = unitDef(u.id)
      if (ROLES[d.role]?.hidden) return false
      const roles = [d.role, ...(u.held ?? []).flatMap((r) => r.roles?.(b, u, r) ?? [])]
      return needs.some(([axis, k]) => (axis === 'kin' ? d.kin === k : roles.includes(k)))
    }
    const kinds = new Map()
    let shadows = 0
    for (const u of b.units) {
      if (u.side !== side || !alive(u) || !counted(u)) continue
      if (u.shadow) shadows++
      else kinds.set(u.id, (kinds.get(u.id) ?? 0) + 1)
    }
    const named = ([kind, n]) => {
      // As three where it counts by its own kin or role (a role a relic lends it counts once).
      const w = needs.some(([axis, k]) => unitDef(kind)[axis] === k) ? synergyWeight({ id: kind }) : 1
      return `${unitDef(kind).name}${n > 1 ? ` ×${n}` : ''}${w > 1 ? ` (as ${w}${n > 1 ? ' each' : ''})` : ''}`
    }
    return [...[...kinds].map(named), shadows > 0 && `${shadows} shadow${shadows === 1 ? '' : 's'}`].filter(Boolean).join(', ')
  }

  // End Turn's own part as it would play now: what each untouched piece of yours would do; `won`; null while busy.
  endInfo () {
    if (this.locked() || this.ending) return null
    const b = this.battle
    const p = untouchedPreview(b)
    if (!p) return null
    return {
      won: p.over && p.winner === 'party',
      acts: p.acts.map((x) => {
        const name = (uid) => (uid === x.uid ? 'itself' : unitDef(b.byUid.get(uid)?.id ?? x.id).name)
        const laid = (uid) => (x.statuses[uid] ?? []).map((s) => statusDef(s.id).name)
        const hit = Object.entries(x.hits).map(([uid, n]) => [+uid, n]).filter(([uid, n]) => n > 0 && b.byUid.get(uid)?.side === 'foe')
        for (const uid of x.falls) if (!hit.some(([y]) => y === uid)) hit.push([uid, 0])
        return {
          name: unitDef(x.id).name, shadow: x.shadow, hexed: x.hexed, act: x.ability ? abilityDef(x.ability).name : null,
          target: x.target != null ? name(x.target) : null, missed: x.missed.length > 0,
          hits: hit.map(([uid, n]) => ({ name: name(uid), n, falls: x.falls.includes(uid), laid: laid(uid) })),
          heals: Object.entries(x.heals).filter(([, n]) => n > 0).map(([uid, n]) => ({ name: name(+uid), n, laid: laid(+uid) })),
          counter: x.counter, fell: x.lost.includes(x.uid), lost: x.lost.filter((uid) => uid !== x.uid).map(name)
        }
      })
    }
  }

  // The lead line of a piece of yours' card: a shadow's way, or a piece's Move, skills and foes in reach; null while busy.
  pieceLine (uid) {
    const b = this.battle
    const u = b.byUid.get(uid)
    if (!u || u.side !== 'party' || u === b.monarch) return null
    if (u.shadow) {
      const a = u.basic ?? u.mend
      const does = a ? `${a === u.basic ? 'strikes with' : 'mends with'} ${a.name} each turn` : 'acts on its own each turn'
      const reap = u.reap > 0 ? Math.round(foeEssence(u, b.floor) * u.reap * this.essence) : 0
      return `${u.summoned ? summonedBy(b, u) : 'Shadow'}: ${does} · ${reap > 0 ? `+${reap} essence more if it stands at the win` : 'gone after the battle'}`
    }
    if (this.locked() || this.ending || !alive(u)) return null
    const skills = u.kit.filter((a) => isSkill(u, a)).map((a) => (u.cooldowns[a.id] > 0 ? `${a.name} ready in ${u.cooldowns[a.id]}` : `${a.name} ready`))
    if (u.acted) return ['Acted', ...skills].join(' · ')
    const n = u.basic && !hexed(u) ? targetsFrom(b, u, u.basic).length : 0
    return [hexed(u) && 'Hexed: no act this turn', `Move ${Math.max(0, u.move - u.moved)}/${u.move}`, ...skills,
      u.basic && !hexed(u) && (n ? `${n} in reach of ${u.basic.name}` : `no foe in reach of ${u.basic.name}`)].filter(Boolean).join(' · ')
  }

  // The counters' cards as the playback has shown the battle: foes standing and slain, essence owed, bounty, `court`.
  tally () {
    const b = this.battle
    let foes = 0
    let slain = 0
    for (const a of this.actors.values()) if (a.side === 'foe') { if (!a.gone) foes++; else if (a.paid) slain++ }
    const court = this.locked() ? [] : b.units.filter((u) => u.side === 'party' && u.reap > 0 && alive(u))
    return {
      foes, slain, owed: Math.round(this.owed), gain: this.essence,
      bonus: this.args.elite ? Math.round(eliteBonus(b.floor) * this.essence) : 0,
      court: court.length ? { n: court.length, essence: Math.round(court.reduce((n, u) => n + foeEssence(u, b.floor) * u.reap, 0) * this.essence) } : null
    }
  }

  // The camera's shudder, kept for what matters (a heavy fall, the Monarch struck, a boss's turn); none if reduced.
  shake (ms, mag) {
    if (!calm) this.cameras.main.shake(ms, mag)
  }

  // A piece of yours, a boss or the Monarch: its fall shakes and holds.
  heavy (uid) {
    const u = this.units.get(uid)
    return !!u && !u.shadow && (!!unitDef(u.id).boss || u.uid === this.monarch || u.side === 'party')
  }

  flashScreen (ms, r, g, b) {
    if (!calm) this.cameras.main.flash(ms, r, g, b)
  }

  // A beat of stillness on a heavy blow: the tweens all but freeze for `ms`, at most one every 300 ms; none if reduced.
  hitStop (ms) {
    if (calm || this.paused || this.ending) return
    const now = this.game.loop.time
    if (now - (this.lastStop ?? -1e9) < 300) return
    this.lastStop = now
    this.stopUntil = now + ms
    this.tweens.timeScale = 0.04
  }

  // ── stage ────────────────────────────────────────────────────────────────────────────────────

  // A 2×2 piece is drawn BIG× over its four tiles, a flyer HOVER over a fainter shadow; a shadow wears shade pictures.
  addActor (u) {
    const fp = u.size ?? 1
    const big = fp > 1 ? BIG : 1
    const fly = unitDef(u.id).flies ? HOVER : 0
    const home = posAt(u.tile, fp)
    const art = artOf(this, u.id)
    const theirs = u.side === 'foe'
    const skin = !u.shadow ? 'unit' : theirs ? 'shadefoe' : 'shade'
    if (u.shadow) shadeTextures(this, art, skin)
    const crowned = u.uid === this.monarch
    const side = u.shadow ? (theirs ? 0xe0a0bc : RISE) : u.side === 'party' ? PARTY : FOE
    const sprite = this.add.image(home.x, home.y, `${skin}:${art}:alive`).setOrigin(0.5, FEET).setDepth(home.y)
      .setFlipX(facesLeft(u.side))
    const whole = this.units.get(u.uid) ?? u
    const scale = SCALE / RES * big
    // Pictures are drawn on a 96 box, the boss on a bigger one; a trine's pool of shadow spreads under its three (`wide`).
    const size = sprite.height / RES / 96 * big
    const wide = sprite.width / sprite.height
    const shadow = this.add.ellipse(home.x, home.y + 4, 46 * size * wide * (fly ? 0.8 : 1), 13 * size * (fly ? 0.8 : 1), u.shadow ? (theirs ? ROT : RISE) : 0x000000,
      (u.shadow ? 0.4 : 0.5) * (fly ? 0.65 : 1)).setDepth(home.y - 2)
    if (u.shadow) shadow.setBlendMode(Phaser.BlendModes.ADD)
    const ring = this.add.ellipse(home.x, home.y + 4, 56 * size * wide, 17 * size).setStrokeStyle(1.5, 0xffffff, 0.8).setDepth(home.y - 1).setVisible(false)
    const barBg = this.add.rectangle(home.x, home.y + 14, BAR + 2, crowned ? 12 : 10, INK, 0.92).setStrokeStyle(1, crowned ? CROWN : INK)
    const width = BAR * u.hp / u.maxHp
    const trail = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, 0xfff1d0, 0.85).setOrigin(0, 0.5)
    const bar = this.add.rectangle(home.x - BAR / 2, home.y + 12, width, crowned ? 6 : 4, side).setOrigin(0, 0.5)
    // A piece of yours carries a pip a skill under its bars; the foes none (a foe's readiness would tell its coming turn).
    const skills = u.side === 'party' && !u.shadow && !crowned ? (whole.kit ?? []).filter((a) => isSkill(whole, a)).map((a) => a.id) : []
    const actor = {
      uid: u.uid, id: u.id, side: u.side, tile: u.tile, art, skin, shade: !!u.shadow, sprite, scale, home, shadow, ring, bar, trail, barBg,
      // fp: its footprint's side, big: its picture's scale for it; hover: how high it floats now (fly: when standing).
      fp, big, fly, hover: fly,
      // chest: how far above the feet blows land; fade: 0 once a corpse has risen as a shadow; rise.v: a shadow coming
      // up (apart from `fade`, so a walk that kills the actor's tweens never leaves it invisible).
      chest: 30 * size + fly, pose: { ...REST }, hp: u.hp, maxHp: u.maxHp, gone: false, fade: 1, rise: { v: 1 },
      // share: how far it has eased aside for another on its tile (SHARE, 0 to 1); vx, up: where that puts it.
      share: 0, vx: home.x, up: 0,
      skills, pips: skills.length ? skills.map(() => this.add.rectangle(home.x, home.y + 19, PIP.w, PIP.h, GOLD).setOrigin(0, 0.5)) : null,
      // The statuses it wears (id → stacks) and its skills' rests (id → turns), as the playback has reached them.
      st: new Map(), cd: {}
    }
    if (u.side === 'party' && !u.shadow && !crowned) actor.growth = growthMarks(this, whole)
    sprite.setInteractive(this.input.makePixelPerfect())
    sprite.on('pointerover', (p) => {
      if (p.wasTouch || touchy()) return
      this.hover = u.uid
      ring.setVisible(!actor.gone)
      this.args.onHover?.(this.seen(u.uid), { left: p.x + 14, right: p.x + 14, top: p.y - 10, bottom: p.y + 10 })
    })
    sprite.on('pointerout', () => {
      ring.setVisible(false)
      if (this.hover === u.uid) { this.hover = null; this.args.onHover?.(null) }
    })
    this.actors.set(u.uid, actor)
  }

  // A long press or a click at viewport (x, y): the front-most unit's card there, pinned; `uid`, the mouse's, first.
  pressAt (x, y, uid = null) {
    if (!this.sys.isActive()) return
    const r = this.game.canvas.getBoundingClientRect()
    const w = this.cameras.main.getWorldPoint((x - r.left) * this.scale.width / r.width, (y - r.top) * this.scale.height / r.height)
    let best = uid != null ? this.actors.get(uid) ?? null : null
    // Two on one tile (SHARE): the one whose picture's middle is nearer.
    const off = (a) => { const b = a.sprite.getBounds(); return Math.hypot(b.centerX - w.x, b.centerY - w.y) }
    if (!best) for (const a of this.actors.values()) {
      if (!a.sprite.visible || a.sprite.alpha <= 0.05 || !a.sprite.getBounds().contains(w.x, w.y)) continue
      if (!best || a.sprite.y > best.sprite.y + 0.5 || (a.sprite.y > best.sprite.y - 0.5 && off(a) < off(best))) best = a
    }
    if (best) this.args.onHover?.(this.seen(best.uid), { left: x + 14, right: x + 14, top: y - 10, bottom: y + 10 }, true)
  }

  // A unit as the playback has reached it, for its card: while an order plays back, its HP and statuses are the playback's.
  seen (uid) {
    const u = this.units.get(uid)
    const a = this.actors.get(uid)
    if (!u || !a || !this.locked() || this.ending) return u
    const statuses = [...a.st].map(([id, stacks]) => ({ ...(u.statuses.find((x) => x.id === id) ?? { id, dur: null }), stacks }))
    return { ...u, hp: a.gone ? 0 : a.hp, statuses }
  }

  // ── orders ───────────────────────────────────────────────────────────────────────────────────────

  // A press: a tap once the pointer lifts where it went down; by touch, held still, the unit's card instead, pinned.
  down (e) {
    // A press by touch or pen: where the mouse last rested no longer stands for a hover (pointedAt).
    if (e.pointerType !== 'mouse') this.pointer = null
    if (e.pointerType === 'touch' ? !e.isPrimary : e.button !== 0) return
    const at = { id: e.pointerId, x: e.clientX, y: e.clientY, held: false }
    const press = e.pointerType === 'touch' ? hold(e, () => { at.held = true; this.pressAt(e.clientX, e.clientY) }) : null
    const off = () => {
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', cancel, true)
    }
    const up = (m) => {
      if (m.pointerId !== at.id) return
      off()
      press?.cancel()
      if (!at.held && Math.hypot(m.clientX - at.x, m.clientY - at.y) <= TAP_SLOP) this.tap(m.clientX, m.clientY)
    }
    const cancel = (m) => { if (m.pointerId === at.id) off() }
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', cancel, true)
  }

  worldAt (x, y) {
    const r = this.game.canvas.getBoundingClientRect()
    return this.cameras.main.getWorldPoint((x - r.left) * this.scale.width / r.width, (y - r.top) * this.scale.height / r.height)
  }

  // Whether the board takes no orders now: an order's events still playing, the battle over, or not its orders phase.
  locked () {
    return this.waiting || !this.player.finished || this.battle.over || this.battle.phase !== 'orders' || this.ending
  }

  // A tap: with a piece selected, a target of its armed act is aimed, tapped again struck; a lit tile is a move; its old
  // tile undoes it. Else a piece of yours is selected (again: let go), anyone else's card shows, empty ground lets go.
  tap (x, y) {
    if (!this.sys.isActive() || this.ending || this.paused || this.locked()) return
    const w = this.worldAt(x, y)
    const tile = tileUnder(w.x, w.y)
    const b = this.battle
    const hits = this.unitsAt(w, tile)
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    // A studied foe's reach goes with any tap; one on a met foe draws its own.
    const studied = this.studied
    this.studied = null
    if (u) {
      const t = hits.find((x) => s.targets.has(x.uid))
      if (t) return t.uid === s.aim ? this.commit() : this.aim(t.uid)
      // Off the board (tileUnder snaps to the nearest tile on it) nothing moves.
      const on = !offBoard(w)
      if (on && this.undoable(u) && footprint(u.from, u.size ?? 1).includes(tile) && !hits.some((x) => x !== u && alive(x))) return this.undo()
      const to = on ? this.anchorFor(u, tile) : null
      if (to != null) return this.send({ type: 'move', uid: u.uid, tile: to })
    }
    const mine = hits.find((x) => alive(x) && orderable(b, x))
    if (mine) return this.select(mine.uid === s?.uid ? null : mine.uid)
    const other = hits.find(alive)
    if (other) {
      this.study(other, studied)
      if (s) this.aim(null)
      else this.plan()
      return this.pressAt(x, y, other.uid)
    }
    this.select(null)
  }

  // A foe of a kind met has its reach drawn until the next tap elsewhere or on it again (`was`: the one studied before).
  study (u, was = null) {
    const met = u?.side === 'foe' && (this.args.met?.(u.id) ?? false)
    this.studied = met && was !== u.uid ? u.uid : null
  }

  // The units at a world point, as a tap reads it: the living first, then those under the point, then the nearest.
  unitsAt (w, tile) {
    const out = []
    for (const u of this.battle.units) {
      const a = this.actors.get(u.uid)
      if (!a || a.fade <= 0.05) continue
      const on = (footprint(u.tile, u.size ?? 1) ?? [u.tile]).includes(tile)
      const box = a.sprite.getBounds()
      const over = a.sprite.visible && box.contains(w.x, w.y)
      if (!on && !over) continue
      out.push({ u, on, over, d: Math.hypot(box.centerX - w.x, box.centerY - w.y) })
    }
    return out.sort((p, q) => alive(q.u) - alive(p.u) || q.over - p.over || p.d - q.d || q.on - p.on).map((x) => x.u)
  }

  // The anchor the selected piece would move to for a tap on `tile` (a 2×2's whose footprint covers it); null out of range.
  anchorFor (u, tile) {
    const r = this.sel.reach
    if (r.has(tile)) return tile
    if ((u.size ?? 1) > 1) for (const t of r.keys()) if (footprint(t, u.size).includes(tile)) return t
    return null
  }

  undoable (u) {
    return u.moved > 0 && !u.acted && endable(this.battle, u, u.from)
  }

  // Selects a piece of yours (null: none), its act armed: the one the player armed for it, else firstAct's.
  select (uid) {
    const b = this.battle
    const u = uid == null ? null : b.byUid.get(uid)
    const same = u && this.sel?.uid === uid
    this.dropMarks()
    this.sel = u ? { uid, ability: same ? this.sel.ability : this.firstAct(u), chosen: same && this.sel.chosen, aim: null, reach: new Map(), targets: new Set() } : null
    if (u) sfx.play('select')
    this.plan()
    this.changed()
  }

  // A piece's first act to arm: the first of its basic, its heal and the rest with a target from here, else its basic.
  firstAct (u) {
    const b = this.battle
    const list = [u.basic, u.mend, ...u.kit.filter((a) => a !== u.basic && a !== u.mend)].filter(Boolean)
    return (list.find((a) => canAct(b, u) && usable(b, u, a) && targetsFrom(b, u, a).length) ?? list[0])?.id ?? null
  }

  arm (id) {
    const s = this.sel
    if (!s || this.locked()) return
    s.ability = id
    s.chosen = true
    this.aim(null)
    this.plan()
    this.changed()
  }

  // What the selection lights, from the sim: a ring under each of yours that may act; for the selected one its Move range,
  // Undo's tile, its act's reach and targets, dashed what a move brings in reach, and its ghost on the hovered Move tile.
  plan () {
    const g = this.planG.clear()
    this.shotG.clear()
    this.dropGhost()
    if (this.locked()) return this.dropMarks()
    const b = this.battle
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    if (s && (!u || !alive(u) || !orderable(b, u))) this.sel = null
    const foot = (x) => posAt(x.tile, x.size ?? 1)
    const ring = (x, colour, alpha, line, grow = 0, p = foot(x)) => {
      const k = (x.size ?? 1) > 1 ? BIG : 1
      inked(g, line, colour, alpha, (g) => g.strokeEllipse(p.x, p.y + 4, (58 + grow) * k, (18 + grow / 3) * k))
    }
    for (const x of b.units) if (x !== u && orderable(b, x) && canAct(b, x)) ring(x, PARTY, 0.5, 2)
    this.drawStudy(g)
    if (!this.sel) return
    const size = u.size ?? 1
    s.reach = u.acted ? new Map() : reach(b, u)
    const a = u.kit.find((x) => x.id === s.ability)
    const can = !!a && canAct(b, u) && usable(b, u, a)
    const from = (t) => (can ? targetsFrom(b, u, a, t).map((x) => x.uid) : [])
    s.targets = new Set(from(u.tile))
    const cell = (c, fill, line, colour) => {
      const box = cellsBox(tileX(c), tileX(c), tileY(c), tileY(c), 4)
      if (fill) g.fillStyle(colour, fill).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8)
      inked(g, 1.5, colour, line, (g) => g.strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8))
    }
    const cells = new Set()
    for (const t of s.reach.keys()) for (const c of footprint(t, size) ?? [t]) cells.add(c)
    for (const c of cells) cell(c, 0.16, 0.5, PLAN)
    if (this.undoable(u)) for (const c of footprint(u.from, size)) cell(c, 0, 0.55, 0xffffff)
    const at = this.pointedAt(u)
    const here = at ?? u.tile
    const spot = (x) => (x === u && at != null ? posAt(at, size) : foot(x))
    const colour = a?.shape === 'corpse' ? DOMAIN : a && !isBlow(a) ? BOON : FOE
    // Once a target is aimed, what a move would bring stands back.
    const fade = s.aim != null ? 0.5 : 1
    const r = can ? actReach(b, u, a) : null
    if (r != null) {
      const box = ringBox(here, r, REACH.pad, size)
      if (a.shape !== 'corpse') paintReach(g, box, colour)
      else {
        g.fillStyle(DOMAIN, 0.05).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, REACH.round)
        inked(g, 1.5, DOMAIN, 0.55, (g) => g.strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, REACH.round))
      }
      inked(g, REACH.line, colour, 0.5 * fade, (g) => envelope(g, [u.tile, ...s.reach.keys()], r, size, box))
    }
    if (at != null) {
      const path = [foot(u), ...s.reach.get(at).map((t) => posAt(t, size))]
      for (let i = 1, d = 12; i < path.length; i++) {
        const [v, w] = [path[i - 1], path[i]]
        const len = Math.hypot(w.x - v.x, w.y - v.y)
        for (; d < len; d += 12) {
          const [x, y] = [v.x + (w.x - v.x) * d / len, v.y + 4 + (w.y - v.y) * d / len]
          g.fillStyle(INK, 0.4).fillCircle(x, y, 3.8).fillStyle(0xffffff, 0.55).fillCircle(x, y, 2.5)
        }
        d -= len
      }
      ring(u, 0xffffff, 0.45, 2, 0, spot(u))
      this.ghost = { tile: at, img: this.ghostOf(u, at) }
    }
    const p = foot(u)
    const k = size > 1 ? BIG : 1
    g.fillStyle(0xffffff, 0.1).fillEllipse(p.x, p.y + 4, 70 * k, 22 * k)
    ring(u, 0xffffff, 0.95, 3, 6)
    // Aimed through a screen, the piece that takes the blow is lit as the aimed one is.
    const shot = s.aim != null ? s.shot : null
    const solid = at != null ? new Set(from(at)) : s.targets
    const later = new Set([...s.targets, ...[...s.reach.keys()].flatMap(from)].filter((x) => !solid.has(x)))
    for (const uid of solid) {
      const x = b.byUid.get(uid)
      const q = spot(x)
      const kx = (x.size ?? 1) > 1 ? BIG : 1
      const on = uid === s.aim || uid === shot?.hit
      const dim = s.aim != null && !on
      g.fillStyle(colour, on ? 0.3 : dim ? 0.06 : 0.14).fillEllipse(q.x, q.y + 4, 58 * kx, 18 * kx)
      ring(x, colour, on ? 1 : dim ? 0.35 : 0.85, on ? 4 : 2.5, on ? 8 : 0, q)
    }
    // Faintly filled too, so they still read where the body of the foe in front stands over the dashes.
    for (const uid of later) {
      const x = b.byUid.get(uid)
      const q = foot(x)
      const kx = (x.size ?? 1) > 1 ? BIG : 1
      g.fillStyle(colour, 0.08 * fade).fillEllipse(q.x, q.y + 4, 58 * kx, 18 * kx)
      inked(g, 3, colour, 0.85 * fade, (g) => dashedEllipse(g, q.x, q.y + 4, 58 * kx, 18 * kx))
    }
    if (shot) this.drawShot(g, u, shot)
  }

  // The studied foe's reach, the sim's own: every tile it could strike next turn, hatched, and its road within its Move.
  drawStudy (g) {
    const u = this.studied != null ? this.battle.byUid.get(this.studied) : null
    if (!u || !alive(u)) { this.studied = null; return }
    const { move, ground } = threatOf(this.battle, u)
    const on = new Set(ground)
    const box = (c) => cellsBox(tileX(c), tileX(c), tileY(c), tileY(c), 0)
    for (const c of on) {
      const b = box(c)
      g.fillStyle(FOE, STUDY.fill).fillRect(b.l, b.t, b.r - b.l, b.b - b.t)
    }
    // The hatch: lines x + y = k on one grid over the whole board, so they run on from cell to cell.
    g.lineStyle(STUDY.hatchW, FOE, STUDY.hatch)
    for (const c of on) {
      const b = box(c)
      for (let k = Math.ceil((b.l + b.t) / STUDY.step) * STUDY.step; k < b.r + b.b; k += STUDY.step) {
        const [x0, x1] = [Math.max(b.l, k - b.b), Math.min(b.r, k - b.t)]
        if (x1 > x0) g.lineBetween(x0, k - x0, x1, k - x1)
      }
    }
    // Its edge: each side of a cell with no struck cell past it.
    const has = (x, y) => x >= 0 && x < LANES && y >= 0 && y < DEPTH && on.has(tileAt(x, y))
    inked(g, STUDY.edge, FOE, 0.9, (g) => {
      for (const c of on) {
        const [x, y] = [tileX(c), tileY(c)]
        const b = box(c)
        if (!has(x, y + 1)) g.lineBetween(b.l, b.t, b.l, b.b)
        if (!has(x, y - 1)) g.lineBetween(b.r, b.t, b.r, b.b)
        if (!has(x + 1, y)) g.lineBetween(b.l, b.t, b.r, b.t)
        if (!has(x - 1, y)) g.lineBetween(b.l, b.b, b.r, b.b)
      }
    })
    // Its road within its Move: dots from its feet, a dashed ring on the farthest it could come.
    const pts = move.map((t) => posAt(t, u.size ?? 1))
    for (let i = 1, d = 12; i < pts.length; i++) {
      const [v, w] = [pts[i - 1], pts[i]]
      const len = Math.hypot(w.x - v.x, w.y - v.y)
      for (; d < len; d += 12) {
        const [x, y] = [v.x + (w.x - v.x) * d / len, v.y + 4 + (w.y - v.y) * d / len]
        g.fillStyle(INK, 0.45).fillCircle(x, y, 3.8).fillStyle(FOE, 0.95).fillCircle(x, y, 2.5)
      }
      d -= len
    }
    const p = pts[0]
    inked(g, 3, FOE, 0.95, (g) => g.strokeEllipse(p.x, p.y + 4, 62, 20))
    if (pts.length > 1) inked(g, 2.5, FOE, 0.85, (g) => dashedEllipse(g, pts.at(-1).x, pts.at(-1).y + 4, 58, 18))
  }

  // Where a click at the mouse would move the selected piece; null off its Move tiles, on a target or Undo's, by touch.
  pointedAt (u) {
    const s = this.sel
    if (!this.pointer || !s || s.aim != null || this.paused || this.locked() || !s.reach.size) return null
    const w = this.worldAt(this.pointer.x, this.pointer.y)
    if (offBoard(w)) return null
    const tile = tileUnder(w.x, w.y)
    if (this.undoable(u) && footprint(u.from, u.size ?? 1).includes(tile)) return null
    return this.unitsAt(w, tile).some((x) => s.targets.has(x.uid)) ? null : this.anchorFor(u, tile)
  }

  // The mouse over the board (never a finger): the plan follows it on and off Move tiles, redrawn as the tile changes.
  point (e) {
    if (e.pointerType !== 'mouse' || !this.sys.isActive()) return
    this.pointer = e.type === 'pointerleave' ? null : { x: e.clientX, y: e.clientY }
    const u = this.sel && this.battle.byUid.get(this.sel.uid)
    if ((u ? this.pointedAt(u) : null) !== this.ghost.tile) this.plan()
  }

  // The selected piece's ghost standing on anchor `at` (plan): its picture, faint, with no bars.
  ghostOf (u, at) {
    const a = this.actors.get(u.uid)
    if (!a) return null
    const p = posAt(at, a.fp)
    const img = this.add.image(p.x, p.y, `${a.skin}:${a.art}:alive`).setFlipX(a.sprite.flipX).setScale(a.scale).setAlpha(0.4).setDepth(p.y - 0.5)
    return img.setOrigin(0.5, FEET + a.fly / img.displayHeight)
  }

  dropGhost () {
    this.ghost.img?.destroy()
    this.ghost = { tile: null, img: null }
  }

  // An aimed blow's line of fire: the tiles it crosses, faint, and the line to the piece that takes it, dashed past it.
  drawShot (g, u, shot) {
    const b = this.battle
    const hit = b.byUid.get(shot.hit)
    const aimed = b.byUid.get(shot.aim)
    if (!hit || !aimed) return
    const colour = hex(C.warn)
    const covers = new Set(footprint(hit.tile, hit.size ?? 1) ?? [hit.tile])
    for (const t of shot.line) {
      if (covers.has(t)) break
      const box = cellsBox(tileX(t), tileX(t), tileY(t), tileY(t), 10)
      g.fillStyle(colour, 0.08).fillRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8)
      inked(g, 1.5, colour, 0.4, (g) => g.strokeRoundedRect(box.l, box.t, box.r - box.l, box.b - box.t, 8))
    }
    lineOfFire(this.shotG, this.chestOf(u.uid), this.chestOf(hit.uid), shot.aim !== shot.hit ? this.chestOf(aimed.uid) : null, colour, this.cameras.main.zoom)
  }

  // Where a blow flies from and lands on a unit (its chest), as it stands now.
  chestOf (uid) {
    const a = this.actors.get(uid)
    return a ? { x: a.vx ?? a.sprite.x, y: a.sprite.y - a.chest } : null
  }

  // Aims the selected piece's armed act at `uid` (null: none): the sim's preview in numbers over the struck, a counter's.
  aim (uid) {
    const s = this.sel
    this.dropMarks()
    if (!s) return
    s.aim = null
    s.shot = null
    const p = uid == null ? null : preview(this.battle, s.uid, s.ability, uid)
    if (p) {
      s.aim = uid
      // A ranged blow keeps to its line: SCREENED over the one aimed at when another takes it, GUARDED for a Bodyguard.
      s.shot = this.shotOf(s, p, uid)
      if (s.shot && s.shot.hit !== uid) this.mark(uid, 'SCREENED', '#d8d0ff', 12)
      if (s.shot && p.struck != null && p.struck !== s.shot.hit) this.mark(s.shot.hit, 'GUARDED', '#d8d0ff', 12)
      // FALLS over every one the act would fell, with a number of its own or not.
      const hits = Object.entries(p.hits).filter(([, d]) => d > 0)
      const falls = new Set(p.falls)
      const shown = this.aimMarks.length
      for (const [x, d] of hits) this.mark(+x, `−${d}${falls.has(+x) ? ' · FALLS' : ''}`, falls.has(+x) ? '#ff8a9a' : '#ffe6c8')
      for (const x of falls) if (!(p.hits[x] > 0)) this.mark(x, 'FALLS', '#ff8a9a')
      // Each one it would mend, and over each the statuses it would wear (stacks, turns), CLEANSED, and RISES for a corpse.
      for (const [x, n] of Object.entries(p.heals ?? {})) if (n > 0) this.mark(+x, `+${n}`, '#7be0a0')
      for (const [x, list] of Object.entries(p.statuses ?? {})) {
        for (const st of list) {
          const d = statusDef(st.id)
          this.mark(+x, `${d.name.toUpperCase()}${st.stacks > 1 ? ` ×${st.stacks}` : ''}${st.dur === 'battle' ? '' : ` ${st.dur}T`}`,
            d.tags.includes('debuff') ? C.foe : C.synergy, 12)
        }
      }
      for (const [x, list] of Object.entries(p.cleansed ?? {})) this.mark(+x, list.length > 1 ? `CLEANSED ×${list.length}` : 'CLEANSED', C.synergy, 12)
      for (const x of p.rises ?? []) this.mark(x, 'RISES', C.shadow, 12)
      // An act with nothing to show (a cooldown's): its name over the target.
      if (this.aimMarks.length === shown) this.mark(uid, abilityDef(s.ability).name, '#d8d0ff', 12)
      if (p.counter > 0) this.mark(s.uid, `↩ −${p.counter}`, '#ffb27a')
      this.lockOn(uid)
      sfx.play('click')
    }
    this.plan()
    this.changed()
  }

  // The line of fire of the act aimed at `uid`: { line (the tiles between), hit (where it stops), aim }, or null unlined.
  shotOf (s, p, uid) {
    const b = this.battle
    const u = b.byUid.get(s.uid)
    const target = b.byUid.get(uid)
    const a = u?.kit.find((x) => x.id === s.ability)
    if (!a || !target || !lined(a) || target.side === u.side) return null
    const line = p.line?.length ? p.line : lineOf(b, u, target, a)
    return { line, hit: lineStruck(b, u, a, target).uid, aim: uid }
  }

  // A preview's number over a unit, held until the aim changes; a second over the same unit stands over the first.
  mark (uid, text, colour, size = 15) {
    const a = this.actors.get(uid)
    if (!a) return
    const z = this.cameras.main.zoom
    const under = this.aimMarks.filter((m) => m.getData('uid') === uid).reduce((y, m) => Math.min(y, m.y - m.displayHeight + 2), Infinity)
    const y = Math.min(a.sprite.y - a.chest - a.hover - 24, under)
    const t = this.text(a.vx ?? a.sprite.x, y, text, labelSize(size, z, 'num'), colour, 4).setOrigin(0.5, 1).setDepth(9700)
    this.aimMarks.push(t.setData('uid', uid))
  }

  // The aimed target's lock-on: brackets closing on its tile, a ripple from its feet, a ticked badge; no ripple if reduced.
  lockOn (uid) {
    const a = this.actors.get(uid)
    if (!a) return
    const colour = hex(C.warn)
    const z = this.cameras.main.zoom
    const k = 1 / Math.max(0.35, Math.min(1, z || 1))
    const big = a.fp > 1 ? BIG : 1
    const cell = cellsBox(tileX(a.tile), tileX(a.tile) + a.fp - 1, tileY(a.tile), tileY(a.tile) + a.fp - 1, REACH.pad)
    const [hw, hh] = [(cell.r - cell.l) / 2, (cell.b - cell.t) / 2]
    const arm = Math.min(hw, hh) * 0.42
    const g = this.add.graphics().setPosition((cell.l + cell.r) / 2, (cell.t + cell.b) / 2).setDepth(9650)
    for (const [w, c, alpha] of [[6 * k, INK, 0.75], [3 * k, colour, 1]]) {
      const l = arm + (w - 3 * k) / 2
      g.fillStyle(c, alpha)
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const [cx, cy] = [sx * hw, sy * hh]
        g.fillRect(Math.min(cx + sx * w / 2, cx - sx * l), cy - w / 2, l + w / 2, w)
        g.fillRect(cx - w / 2, Math.min(cy - sy * w / 2, cy - sy * l), w, l - w / 2)
      }
    }
    // The badge just right of the widest of its numbers (over its head without one).
    const R = labelSize(15, z, 'num') * 0.55
    const t = this.aimMarks.filter((m) => m.getData('uid') === uid).sort((m, n) => n.displayWidth - m.displayWidth)[0]
    const x = a.vx ?? a.sprite.x
    const [bx, by] = t ? [t.x + t.displayWidth / 2 + R + 3 * k, t.y - t.displayHeight / 2] : [x, a.sprite.y - a.chest - a.hover - 24 - R]
    const badge = this.add.graphics().setPosition(bx, by).setDepth(9710)
    const check = [{ x: -0.45 * R, y: 0 }, { x: -0.12 * R, y: 0.34 * R }, { x: 0.46 * R, y: -0.34 * R }]
    badge.fillStyle(INK, 0.9).fillCircle(1.5 * k, 2 * k, R + 2 * k).fillCircle(0, 0, R + 2 * k).fillStyle(colour, 1).fillCircle(0, 0, R)
    badge.lineStyle(0.3 * R, INK, 1).strokePoints(check).fillStyle(INK, 1).fillCircle(check[1].x, check[1].y, 0.15 * R)
    this.lock = [g, badge]
    if (calm) return
    const ripple = this.add.graphics().setPosition(x, a.sprite.y + 4).setDepth(-380)
    inked(ripple, 2.5 * k, colour, 1, (g) => g.strokeEllipse(0, 0, 58 * big, 18 * big))
    this.lock.push(ripple)
    g.setScale(1.4).setAlpha(0)
    this.tweens.add({
      targets: g, scale: 1, alpha: 1, duration: 200, ease: 'Cubic.Out',
      onComplete: () => { if (g.scene) this.tweens.add({ targets: g, scale: 1.07, duration: 520, ease: 'Sine.InOut', yoyo: true, repeat: -1 }) }
    })
    badge.setScale(0)
    this.tweens.add({ targets: badge, scale: 1, delay: 120, duration: 200, ease: 'Back.Out' })
    this.tweens.add({ targets: ripple, scale: { from: 0.6, to: 1.7 }, alpha: { from: 0.9, to: 0 }, duration: 900, repeatDelay: 200, repeat: -1, ease: 'Cubic.Out' })
  }

  dropMarks () {
    for (const t of [...this.aimMarks, ...this.lock]) {
      this.tweens.killTweensOf(t)
      t.destroy()
    }
    this.aimMarks = []
    this.lock = []
  }

  // The second tap on the aimed target: the act is given.
  commit () {
    const s = this.sel
    this.send({ type: 'act', uid: s.uid, ability: s.ability, target: s.aim })
  }

  // Paused, the board takes no orders: one given would wait unplayed behind the veil.
  undo () {
    if (this.sel && !this.locked() && !this.paused) this.send({ type: 'undo', uid: this.sel.uid })
  }

  // End Turn: the untouched act, the foes take their turn, and it all plays back.
  endTurn () {
    if (this.locked() || this.paused) return
    this.studied = null
    this.select(null)
    this.send({ type: 'end' })
  }

  // Gives an order (the run applies it) and plays back its events; the board waits until they have played (settle).
  send (o) {
    let events
    try {
      events = this.args.order(o)
    } catch (e) {
      console.warn(`order refused: ${e.message}`)
      sfx.play('poor')
      return this.plan()
    }
    this.dropMarks()
    this.dropGhost()
    if (this.sel) { this.sel.aim = null; this.sel.shot = null }
    this.planG.clear()
    this.shotG.clear()
    this.waiting = true
    this.player.enqueue(events ?? [])
    this.changed()
  }

  // An order played out: the selection stays on a piece that may still act, re-armed unless chosen; else it is let go.
  settle () {
    const s = this.sel
    const u = s && this.battle.byUid.get(s.uid)
    if (u && (!alive(u) || !orderable(this.battle, u) || u.acted)) this.sel = null
    else if (u && !s.chosen) s.ability = this.firstAct(u)
    this.plan()
    this.changed()
  }

  // Skip: every beat queued plays now.
  flush () {
    if (!this.player.finished) this.playMs = Math.max(this.playMs, this.player.end)
  }

  // What act `id` of the selected piece does, for its button's card: the act, its stats, its reach (Infinity: anywhere),
  // Arise's; while it may act, the sim's preview on each it can take now (`by`: who takes it instead), and `later`.
  actInfo (id) {
    const b = this.battle
    const u = this.sel && b.byUid.get(this.sel.uid)
    const a = u?.kit.find((x) => x.id === id)
    if (!a || !alive(u)) return null
    const range = isBlow(a) ? blowReach(u, a) : holds(b, u.side, 'sanctuary') ? Infinity : rangeOf(a)
    const free = !this.locked() && canAct(b, u) && usable(b, u, a)
    const now = free ? targetsFrom(b, u, a) : []
    const later = new Map()
    if (free) for (const t of reach(b, u).keys()) for (const x of targetsFrom(b, u, a, t)) if (!now.includes(x)) later.set(x.uid, x)
    const name = (x) => unitDef(x.id).name
    return {
      a, st: stats(b, u), range, flies: !!u.flies, arise: a.shape === 'corpse' ? ariseOf(b, u) : null,
      now: now.map((x) => {
        const p = preview(b, u.uid, a.id, x.uid)
        const by = p && p.struck !== x.uid ? b.byUid.get(p.struck) : null
        return { name: name(x), self: x === u, damage: p?.damage ?? 0, heal: p?.heal ?? 0, counter: p?.counter ?? 0, falls: !!p?.kills, by: by && name(by) }
      }),
      later: [...later.values()].map(name)
    }
  }

  // The selected piece's panel for the chrome: HP, Move, relics, each act's state, Undo and its tile; null with none.
  panel () {
    const b = this.battle
    const s = this.sel
    const u = s && b.byUid.get(s.uid)
    if (!u || !alive(u)) return null
    const free = !this.locked()
    const acts = u.kit.map((a) => {
      const can = free && canAct(b, u) && usable(b, u, a)
      // How many turns it rests once used (its cooldown, 2 where absent, or a granting rule's), less the turn it is used in.
      const rests = isSkill(u, a) ? Math.min(a.cooldown ?? 2, ...u.held.filter((r) => r.grants === a.id && r.params.cooldown).map((r) => r.params.cooldown)) - 1 : 0
      return {
        id: a.id, name: a.name, skill: isSkill(u, a), heal: !isBlow(a), rest: u.cooldowns[a.id] ?? 0, rests, armed: a.id === s.ability, can,
        targets: can ? targetsFrom(b, u, a).length : 0, arise: a.shape === 'corpse' ? ariseOf(b, u) : null
      }
    })
    return {
      uid: u.uid, id: u.id, hp: u.hp, maxHp: u.maxHp, move: u.move, moved: u.moved, acted: u.acted, hexed: hexed(u), relics: u.relics ?? [],
      acts, aim: s.aim != null, undo: free && this.undoable(u), from: u.from,
      // Aimed through a screen: the kind of the piece on the line that takes the blow.
      screen: s.aim != null && s.shot && s.shot.hit !== s.aim ? unitDef(b.byUid.get(s.shot.hit)?.id ?? b.byUid.get(s.aim).id).name : null
    }
  }

  // ── animation ────────────────────────────────────────────────────────────────────────────────

  // Plays keyframes on a unit's pose: each tweens to `to` over `ms`; a living unit goes back to its alive picture first.
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

  // A living unit's poses; its leans point at `toward`, the other unit in the exchange.
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

  // A move walks its whole path, hopping, a tile STEP_MS; an undo goes straight back.
  walk (ev) {
    const a = this.actors.get(ev.actor)
    if (!a || a.gone) return
    const path = ev.type === 'move' && ev.path?.length ? ev.path : [ev.to]
    a.tile = ev.to
    a.home = posAt(ev.to, a.fp)
    this.halt(a)
    const ms = STEP_MS
    const lean = Math.sign(a.home.x - a.sprite.x) || 1
    if (path.length === 1) this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: ms, ease: 'Sine.InOut' })
    else {
      const points = [{ x: a.sprite.x, y: a.sprite.y }, ...path.map((t) => posAt(t, a.fp))]
      a.walker = this.tweens.addCounter({
        from: 0, to: path.length, duration: ms * path.length,
        onUpdate: (tw) => {
          const v = tw.getValue()
          const i = Math.min(path.length - 1, Math.floor(v))
          const f = v - i
          a.sprite.setPosition(points[i].x + (points[i + 1].x - points[i].x) * f, points[i].y + (points[i + 1].y - points[i].y) * f)
        }
      })
    }
    this.animate(a, path.flatMap(() => [
      { to: { lean: 5 * lean, sy: 0.05, dy: -7 }, ms: ms * 0.4, ease: 'Sine.Out' },
      { to: { lean: -2 * lean, sx: 0.06, sy: -0.07 }, ms: ms * 0.4, ease: 'Sine.In' },
      { to: REST, ms: ms * 0.2 }]))
  }

  halt (a) {
    a.walker?.stop()
    a.walker = null
    this.tweens.killTweensOf([a.sprite, a])
  }

  // A flyer that falls comes down to the ground.
  drop (a) {
    if (a.hover) this.tweens.add({ targets: a, hover: 0, duration: 260, ease: 'Quad.In' })
  }

  // Death: the unit staggers back from its killer and topples; where it lands it becomes its corpse in a puff of dust.
  fall (a, killer) {
    a.gone = true
    this.drop(a)
    // Its bars empty with it, whatever older event set them last: a fallen unit keeps no HP under its faded bar.
    a.hp = 0
    a.bar.width = 0
    this.tweens.killTweensOf(a.trail)
    this.tweens.add({ targets: a.trail, width: 0, duration: 300, ease: 'Quad.Out' })
    if (a.uid === this.monarch) this.crownHp(a)
    a.ring.setVisible(false)
    this.picture(a, 'alive')
    // A unit can die mid-step: it is sent the rest of the way to its tile now.
    a.walker?.stop()
    this.tweens.killTweensOf(a.sprite)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, duration: 200, ease: 'Sine.Out' })
    const away = killer ? Math.sign(a.sprite.x - killer.sprite.x) || (a.uid % 2 ? 1 : -1) : 1
    const land = () => {
      a.sprite.setTint(0xc4bfd0)
      this.dust.explode(14, a.home.x, a.home.y - 4)
      if (this.heavy(a.uid)) this.shake(90, 0.0025)
      this.wisp(a)
    }
    this.animate(a, [
      { to: { lean: 10 * away, sx: 0.06, sy: -0.08, dx: 6 * away }, ms: 130, ease: 'Quad.Out' },
      { to: { lean: 84 * away, sy: -0.06, dx: 4 * away }, ms: 300, ease: 'Quad.In' },
      { to: { sx: 0.12, sy: -0.2 }, ms: 1, picture: 'dead', start: land },
      { to: REST, ms: 280, ease: 'Back.Out' }])
    this.tweens.add({ targets: this.parts(a), alpha: 0, duration: 300 })
  }

  // What stands beside a unit's picture: its bars, its pool of shadow, its growth.
  parts (a) {
    return [a.bar, a.trail, a.barBg, a.shadow, ...(a.pips ?? []), ...(a.growth?.parts ?? [])].filter(Boolean)
  }

  // The Sovereign fallen, every foe left crumbles to dust, rippling out from it; their souls pay as if slain.
  crumble (a, boss) {
    if (!this.crumbling && boss) {
      this.crumbling = true
      const wave = this.add.image(boss.sprite.x, boss.sprite.y - boss.chest, 'glow').setTint(ROT).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(40, 40).setAlpha(0.9).setDepth(9300)
      this.tweens.add({ targets: wave, displayWidth: 900, displayHeight: 520, alpha: 0, duration: 1100, ease: 'Cubic.Out', onComplete: () => wave.destroy() })
      this.flashScreen(260, 70, 40, 90)
      this.shake(320, 0.006)
    }
    a.gone = true
    a.hp = 0
    this.drop(a)
    a.bar.width = 0
    a.ring.setVisible(false)
    a.walker?.stop()
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

  // Arise: the corpse sinks and its shadow climbs out in a ring of light, then glides to its tile (`from`: the corpse's),
  // from the beam's cast on; a Legion's raise has no actor and waits for the fall to land.
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
    const from = ev.from != null && ev.from !== ev.unit.tile ? posOf(ev.from) : null
    const at = from ?? a.home
    if (from) a.sprite.setPosition(from.x, from.y)
    a.rise.v = 0
    a.pose = { ...REST, sx: -0.3, sy: -0.75 }
    for (const part of this.parts(a)) part.setAlpha(0)
    this.tweens.add({ targets: a.rise, v: 1, delay: LAND, duration: 520, ease: 'Sine.Out' })
    this.tweens.add({ targets: [a.bar, a.trail, a.barBg], alpha: 1, delay: LAND + 300, duration: 300 })
    this.tweens.add({ targets: a.shadow, alpha: 1, delay: LAND, duration: 400 })
    this.animate(a, [
      { to: { sx: -0.3, sy: -0.75 }, ms: LAND },
      { to: { sx: 0.08, sy: 0.1, dy: -6 }, ms: 380, ease: 'Back.Out' },
      { to: REST, ms: 260 }])
    const ring = this.add.image(at.x, at.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(30, 10).setAlpha(0).setDepth(at.y - 1)
    this.tweens.add({
      targets: ring, displayWidth: 120, displayHeight: 34, alpha: { from: 0.9, to: 0 }, delay: LAND, duration: 700, ease: 'Cubic.Out',
      onStart: () => this.burst(at.x, at.y - 4, glow, 16, { up: true, speed: 90 }),
      onComplete: () => ring.destroy()
    })
    if (!from) return
    // The glide: longer the further it goes, never long; a wisp trails it, stopped on time whatever cuts it short.
    const go = LAND + 520
    const ms = Math.min(900, 380 + 70 * Math.hypot(a.home.x - from.x, a.home.y - from.y) / TILE_W)
    const trail = this.add.particles(0, 0, 'spark', {
      emitting: false, lifespan: 460, speed: 10, scale: { start: 0.55, end: 0 }, alpha: { start: 0.8, end: 0 }, tint: glow, frequency: 22, blendMode: 'ADD'
    }).setDepth(9399)
    trail.startFollow(a.sprite, 0, -a.chest)
    this.tweens.add({ targets: a.sprite, x: a.home.x, y: a.home.y, delay: go, duration: ms, ease: 'Sine.InOut', onStart: () => trail.start() })
    this.time.delayedCall(go + ms, () => {
      trail.stop()
      this.time.delayedCall(600, () => trail.destroy())
      if (!a.gone) this.burst(a.sprite.x, a.sprite.y - 4, glow, 8, { up: true, speed: 50 })
    })
  }

  // A unit enters a battle under way: a later wave's foe over the far edge (arrive), a fused piece of yours out of the dark.
  enter (ev) {
    this.units.set(ev.unit.uid, this.battle.byUid.get(ev.unit.uid) ?? this.battle.units.find((x) => x.uid === ev.unit.uid))
    this.addActor(ev.unit)
    const a = this.actors.get(ev.unit.uid)
    const glow = ev.unit.side === 'foe' ? FOE : SOUL
    a.rise.v = 0
    for (const part of this.parts(a)) part.setAlpha(0)
    if (ev.unit.side === 'foe') return this.arrive(a)
    this.tweens.add({ targets: a.rise, v: 1, duration: 420, ease: 'Sine.Out' })
    this.tweens.add({ targets: this.parts(a), alpha: 1, delay: 200, duration: 300 })
    const ring = this.add.image(a.home.x, a.home.y + 4, 'glow').setTint(glow).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(90, 26).setAlpha(0.7).setDepth(a.home.y - 1)
    this.tweens.add({ targets: ring, displayWidth: 30, displayHeight: 10, alpha: 0, duration: 520, ease: 'Cubic.In', onComplete: () => ring.destroy() })
    this.burst(a.home.x, a.home.y - 4, glow, 8, { up: true, speed: 50 })
  }

  // A foe of a later wave hops in from past the far (left) edge onto its tile, a red glow where it lands.
  arrive (a) {
    const MS = 560
    a.sprite.setX(a.home.x - TILE_W * 1.3)
    this.tweens.add({ targets: a.rise, v: 1, duration: MS * 0.6, ease: 'Sine.Out' })
    this.tweens.add({ targets: a.sprite, x: a.home.x, duration: MS, ease: 'Sine.Out' })
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

  // A foe wave arrives, just before its first foe enters: its name over the top of the board, a red glow down the far edge.
  waveBanner (k) {
    const w = this.waves[k]
    const title = w?.boss ? `${unitDef(w.boss).name.toUpperCase()} COMES` : `THE ${ORDINAL[k] ?? `${k + 1}TH`} WAVE`
    const sub = w ? `${w.size} ${w.size === 1 ? 'foe enters' : 'foes enter'} from the far edge${w.boss ? ', its court about it' : ''}` : 'More foes enter from the far edge'
    const edge = this.add.image(-HALF_W - TILE_W / 2, 0, 'glow').setTint(FOE).setBlendMode(Phaser.BlendModes.ADD)
      .setDisplaySize(46, 2 * HALF_H + 160).setAlpha(0).setDepth(-350)
    this.tweens.add({ targets: edge, alpha: { from: 0.75, to: 0 }, duration: 1800, ease: 'Quad.In', onComplete: () => edge.destroy() })
    const y = -HALF_H + TILE_H * 0.9
    const z = this.cameras.main.zoom
    const head = this.text(0, 0, title, labelSize(17, z), '#ff8a9a', 4).setOrigin(0.5, 0).setDepth(9600).setAlpha(0)
    const line = this.text(0, 0, sub, labelSize(10, z), '#d4b4bd', 0, FONT).setOrigin(0.5, 0).setDepth(9600).setAlpha(0)
    const ph = head.height + line.height + 12
    head.setY(y - ph / 2 + 5)
    line.setY(head.y + head.height + 1)
    const plate = this.plate(0, y, Math.max(HALF_W, head.width + 40, line.width + 40), ph, FOE).setDepth(9590).setAlpha(0)
    this.tweens.add({ targets: [plate, head, line], alpha: 1, duration: 200 })
    this.tweens.add({ targets: [plate, head, line], alpha: 0, delay: 1700, duration: 500, onComplete: () => { plate.destroy(); head.destroy(); line.destroy() } })
    this.shake(180, 0.003)
  }

  newTurn (ev) {
    this.counts = { ...this.counts, turn: ev.turn, next: ev.next }
    this.changed()
    this.flag(`TURN ${ev.turn}`, C.soul2, SOUL)
  }

  // A word across the middle of the board a moment, on a dark plate in its side's colour; the last gives way to the next.
  flag (word, colour, edge) {
    this.flagged?.forEach((o) => o.destroy())
    const z = this.cameras.main.zoom
    const t = this.text(0, 0, word, labelSize(16, z), colour, 4).setOrigin(0.5).setDepth(9600).setAlpha(0)
    const plate = this.plate(0, 0, t.width + 48, t.height + 14, edge).setDepth(9590).setAlpha(0)
    this.flagged = [plate, t]
    this.tweens.add({ targets: this.flagged, alpha: 1, duration: 140 })
    this.tweens.add({ targets: this.flagged, alpha: 0, delay: 650, duration: 300, onComplete: () => { plate.destroy(); t.destroy() } })
  }

  // A foe slain in a battle of waves adds to its wave's tally; once the wave is slain a popup says what it paid.
  slain (a) {
    if (a.side !== 'foe' || a.shade || this.waves.length < 2) return
    const u = this.units.get(a.uid)
    const k = u?.wave ?? 0
    const w = this.waves[k]
    if (!w) return
    w.paid += foeEssence(u, this.battle.floor) * this.essence
    if (--w.left <= 0) this.wavePaid(k)
  }

  wavePaid (k) {
    const w = this.waves[k]
    if (!w || w.shown || w.paid <= 0) return
    w.shown = true
    const name = `WAVE ${k + 1}`
    // Popups shown together stack down the board's middle.
    const now = this.playMs
    this.payStack = now - (this.payAt ?? -1e9) < 900 ? (this.payStack ?? 0) + 1 : 0
    this.payAt = now
    const size = labelSize(12, this.cameras.main.zoom)
    const y = -TILE_H + this.payStack * size * 1.6
    const from = Math.min(1, Math.max(0.6, labelPx('word') / (size * this.cameras.main.zoom)))
    const t = this.text(0, y, `${name} SLAIN · +${Math.round(w.paid)} ESSENCE`, size, C.soul2, 3).setOrigin(0.5).setDepth(9550).setScale(from)
    if (from < 1) this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.Out' })
    this.tweens.add({ targets: t, y: y - 26, alpha: 0, delay: 1300, duration: 900, ease: 'Quad.Out', onComplete: () => t.destroy() })
    this.burst(0, y, SOUL, 12, { up: true, speed: 70 })
  }

  // ── the board, statuses, HP and essence ──────────────────────────────────────────────────────

  // Statuses worn, as the playback has laid them (a.st): flames up a burning picture, a violet pall over a hexed one.
  wear (a) {
    const held = (id) => (!a.gone && a.st.has(id) ? { stacks: a.st.get(id) } : null)
    const burn = held('burning')
    const top = a.sprite.y - a.hover - a.up - a.chest + a.fly
    if (burn && this.playMs >= (a.nextFlame ?? 0)) {
      a.nextFlame = this.playMs + (calm ? 360 : [110, 75, 50][Math.min(3, burn.stacks ?? 1) - 1])
      const w = a.sprite.displayWidth * 0.26
      this.flames.explode(1, a.vx + (Math.random() * 2 - 1) * w, top + (a.chest - a.fly) * (0.1 + Math.random() * 0.7))
    }
    this.palls(a, top)
    const hexed = !!held('hexed')
    if (hexed && !a.pall) a.pall = this.add.image(0, 0, 'glow').setTint(HEX).setBlendMode(Phaser.BlendModes.ADD)
    if (!a.pall) return
    a.pall.setVisible(hexed)
    if (!hexed) return
    const pulse = calm ? 0.5 : 0.42 + 0.12 * Math.sin(this.playMs / 300 + a.uid)
    a.pall.setPosition(a.vx, top).setDisplaySize(a.sprite.displayWidth * 0.95, a.sprite.displayHeight * 0.85)
      .setDepth(a.sprite.depth + 0.2).setAlpha(pulse * a.fade * a.rise.v)
  }

  // Each status held but the two drawn their own way, a faint pall in its colour, each a little lower and narrower.
  palls (a, top) {
    const want = a.gone ? [] : [...a.st.keys()].filter((id) => id !== 'hexed' && id !== 'burning' && statusDef(id).colour).map((id) => ({ id }))
    if (!want.length && !a.palls?.size) return
    a.palls ??= new Map()
    for (const [id, img] of a.palls) if (!want.some((x) => x.id === id)) { img.destroy(); a.palls.delete(id) }
    want.forEach((x, i) => {
      let img = a.palls.get(x.id)
      if (!img) a.palls.set(x.id, img = this.add.image(0, 0, 'glow').setTint(hex(statusDef(x.id).colour)).setBlendMode(Phaser.BlendModes.ADD))
      const pulse = calm ? 0.3 : 0.27 + 0.08 * Math.sin(this.playMs / 340 + a.uid + i)
      img.setPosition(a.vx, top + 6 * i).setDisplaySize(a.sprite.displayWidth * (0.9 - 0.12 * i), a.sprite.displayHeight * (0.8 - 0.1 * i))
        .setDepth(a.sprite.depth + 0.1).setAlpha(pulse * a.fade * a.rise.v)
    })
  }

  decorate (start) {
    drawGround(this)
    // The camp's walls, and a rune under every other tile, in its side's colour.
    const g = this.add.graphics().setDepth(-400)
    const zone = (y) => (y < CAMP_ROWS ? PARTY : y >= DEPTH - ROWS ? FOE : NEUTRAL)
    const walls = new Set(start.walls)
    for (const tile of walls) {
      const p = posOf(tile)
      // One of the wall pictures, picked by the tile so a camp always looks the same.
      this.add.image(p.x, p.y + 8, WALLS[(tile * 7 + (tile >> 3)) % WALLS.length]).setOrigin(0.5, WALL_FOOT)
        .setScale(WALL_SCALE / RES).setFlipX(tile % 2 === 1).setDepth(p.y)
    }
    for (let tile = 0; tile < TILES; tile++) {
      if (walls.has(tile)) continue
      const p = posOf(tile)
      g.lineStyle(1.2, zone(tileY(tile)), 0.14).strokeEllipse(p.x, p.y + 6, 50, 15)
    }
    // The words (the title, the Monarch's HP) stand in the page's chrome.
    this.args.hud?.start({ title: this.args.title ?? `FLOOR ${this.battle.floor}`, monarch: start.monarch != null })
    const m = start.units.find((u) => u.uid === start.monarch)
    if (m) this.crownHp(m)
  }

  // Undying: a piece that just fell slumps and springs back up on its own tile in a ring of warm light.
  rise (a, ev) {
    a.gone = false
    a.hp = ev.hp
    if (a.fly) this.tweens.add({ targets: a, hover: a.fly, duration: 300, ease: 'Sine.Out' })
    this.tweens.killTweensOf([a.bar, a.trail, a.barBg, a.shadow])
    for (const part of [a.bar, a.trail, a.barBg, a.shadow]) part.setAlpha(1)
    a.bar.width = a.trail.width = BAR * Math.max(0, a.hp / a.maxHp)
    a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY)
    for (const part of a.growth?.parts ?? []) {
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
    this.floating(a, 'RISES', C.legendary, 13)
  }

  // An HP bar set from an event: the trail follows a loss, a gain snaps it; an older `seq` than the last shown does nothing.
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

  crownHp (a) {
    this.args.hud?.hp(Math.max(0, a.hp), a.maxHp)
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

  // A soul leaves the fallen: foes' souls stream toward you, your own fade upward; if reduced, essence lands at once.
  wisp (a) {
    const mine = a.side === 'party'
    if (calm) {
      if (!mine && a.worth) {
        this.purse = Math.min(this.owed, this.purse + a.worth)
        a.worth = 0
        sfx.play('essence')
        this.changed()
      }
      return
    }
    const orb = this.add.image(a.sprite.x, a.sprite.y - a.chest, 'glow').setTint(mine ? 0xb8b4c8 : SOUL).setBlendMode(Phaser.BlendModes.ADD).setScale(0.45).setDepth(9400)
    const trail = this.add.particles(0, 0, 'spark', {
      lifespan: 500, speed: 6, scale: { start: 0.5, end: 0 }, alpha: { start: 0.8, end: 0 },
      tint: mine ? 0xb8b4c8 : SOUL, frequency: 30, blendMode: 'ADD'
    }).setDepth(9399)
    trail.startFollow(orb)
    const done = () => { trail.stopFollow(); trail.stop(); orb.destroy(); this.time.delayedCall(600, () => trail.destroy()) }
    if (mine) {
      this.tweens.add({ targets: orb, y: orb.y - 70, alpha: 0, scale: 0.2, duration: 1300, ease: 'Sine.Out', onComplete: done })
    } else if (a.worth) {
      // A slain foe's soul arcs down to the purse in the playback bar, which ticks up as it lands; a readable size.
      const to = this.purseSpot()
      const k = Math.min(2, 1 / this.cameras.main.zoom)
      orb.setTint(0xb8fff0).setScale(0.5 * k)
      this.tweens.chain({
        targets: orb,
        tweens: [
          { y: orb.y - 34, scale: 0.85 * k, duration: 300, ease: 'Sine.Out' },
          { x: { value: to.x, ease: 'Sine.InOut' }, y: { value: to.y, ease: 'Back.In' }, scale: 0.55 * k, duration: 760 }
        ],
        onComplete: () => {
          this.purse = Math.min(this.owed, this.purse + a.worth)
          a.worth = 0
          this.burst(orb.x, orb.y, SOUL, 6, { up: true, speed: 60 })
          sfx.play('essence')
          this.changed()
          done()
        }
      })
    } else {
      this.tweens.chain({
        targets: orb,
        tweens: [
          { y: orb.y - 30, scale: 0.6, duration: 380, ease: 'Sine.Out' },
          { x: HALF_W + 120, y: 0, scale: 0.25, alpha: 0.2, duration: 900, ease: 'Cubic.In' }
        ],
        onComplete: done
      })
    }
  }

  // A slain foe (not a shadow) carries essence, the relics' share in: owed at once, counted as its orb lands (wisp).
  pay (a) {
    if (a.side !== 'foe' || a.shade || a.paid) return
    const u = this.units.get(a.uid)
    if (!u) return
    a.paid = true
    a.worth = foeEssence(u, this.battle.floor) * this.essence
    this.owed += a.worth
  }

  // The counter in the playback bar, in world space (the bar lies over the canvas); else below the camp.
  purseSpot () {
    const r = this.purseAt?.()
    if (!r?.width) return { x: HALF_W + 120, y: 0 }
    const p = this.cameras.main.getWorldPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { x: p.x, y: p.y }
  }

  // ── react to events the sim already decided ──────────────────────────────────────────────────

  // `seq`: the event's place in the battle's stream (TimelinePlayer), for the HP shown.
  applyEvent (ev, inAction, seq) {
    if (ev.type === 'move' || ev.type === 'undo') return this.walk(ev)
    if (ev.type === 'arise') { sfx.play('arise'); return this.arise(ev) }
    if (ev.type === 'enter') return this.enter(ev)
    // The opening formation is wave 1 but stands there from the start: only a later wave is announced.
    if (ev.type === 'wave') {
      // The wave under way, and the one after it by the schedule until the next turn's event tells it.
      this.counts.wave = Math.max(this.counts.wave, ev.wave + 1)
      if (this.counts.next && this.counts.next.wave <= ev.wave) {
        const w = this.battle.waves.find((x) => x.wave > ev.wave)
        this.counts.next = w ? { wave: w.wave, turn: w.turn } : null
      }
      this.changed()
      return ev.wave > 0 ? this.waveBanner(ev.wave) : undefined
    }
    if (ev.type === 'turn') return this.newTurn(ev)
    if (ev.type === 'stage') return ev.stage === 'foes' ? this.flag('THE FOES\' TURN', '#ff8a9a', FOE) : undefined
    if (ev.type === 'action') {
      // A counter: the struck answers at once, and says so over itself.
      if (ev.counter) { const x = this.actors.get(ev.actor); if (x) this.floating(x, 'COUNTER', '#ffb27a', 11) }
      this.deadeye(ev)
      this.screenedShot(ev)
      return this.reshaped(ev, this.actors.get(ev.actor))
    }
    if (ev.type === 'rule') {
      // A Bodyguard's step, kept a beat for the line its blow was loosed on (screenedShot).
      if (ev.rule === 'bodyguard') this.guarded = ev
      return this.rule(ev)
    }
    // A trigger relic fired for this unit: its name flashes over it (its effects follow as their own events).
    if (ev.type === 'trigger') {
      const x = this.actors.get(ev.unit)
      if (!x) return
      this.floating(x, relicDef(ev.relic).name, C.relic, 11)
      this.burst(x.sprite.x, x.sprite.y - x.chest, hex(C.relic), 6, { up: true, speed: 50 })
      return
    }
    // A death burst: the fallen bursts where it fell, over those around it (what it lays follows as their own events).
    if (ev.type === 'burst') {
      const x = this.actors.get(ev.actor)
      if (x) this.burst(x.home.x, x.home.y - x.chest / 2, x.side === 'foe' ? FOE : SOUL, 16, { speed: 170 })
      return
    }
    // battle:end needs nothing here: the battle is over (update ends it once the playback has caught up).
    const a = ev.target != null ? this.actors.get(ev.target) : null
    if (!a) return
    switch (ev.type) {
      case 'damage':
      case 'heal': {
        // The HP shown is the newest the sim reached: an older event (an Echo's late pass) only flinches and pops.
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
          if (ev.damage > 0) {
            // Knocked back from the attacker; a tick of poison or burn has no attacker to face, so it shudders.
            this.strike(a, 'hurt', inAction ? this.actors.get(ev.actor) : null)
            this.flash(a)
            this.burst(a.sprite.x, a.sprite.y - a.chest, tint(ev.ability), 9, { speed: 140 })
            // The Monarch struck shakes, at most once a second (a mob on it is not a quake).
            if (a.uid === this.monarch && !(this.playMs - this.monarchShook < 1000)) {
              this.monarchShook = this.playMs
              this.shake(120, 0.003)
            }
            sfx.play(a.uid === this.monarch ? 'monarchHit' : 'hit')
          }
        } else {
          a.trail.width = w
          if (ev.heal > 0) this.burst(a.sprite.x, a.sprite.y - 6, 0x7be0a0, 8, { up: true, speed: 50 })
          if (!inAction && ev.heal > 0) this.floating(a, `+${ev.heal}`, '#7be0a0')
        }
        break
      }
      case 'death': {
        a.st.clear()
        this.pay(a)
        if (ev.crumble) this.crumble(a, this.actors.get(ev.actor))
        else this.fall(a, this.actors.get(ev.actor))
        this.slain(a)
        sfx.play('kill')
        // A piece of yours, a boss or the Monarch falling holds the frame, a boss or the Monarch the longest.
        if (!ev.crumble && this.heavy(a.uid)) {
          const u = this.units.get(a.uid)
          this.hitStop(unitDef(u.id).boss || u.uid === this.monarch ? 150 : 80)
        }
        break
      }
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
      // A status in its keyword's colour (a debuff red, a buff blue), beside the unit, apart from the numbers.
      case 'status':
        a.st.set(ev.status, Math.min(statusDef(ev.status).stacks ?? 1, (a.st.get(ev.status) ?? 0) + 1))
        this.floating(a, statusDef(ev.status).name, statusDef(ev.status).tags.includes('debuff') ? C.foe : C.synergy, 11, 1, true)
        break
      case 'cleanse':
        a.st.delete(ev.status)
        this.burst(a.sprite.x, a.sprite.y - a.chest, BOON, 6, { up: true, speed: 40 })
        break
      case 'expire':
        a.st.delete(ev.status)
        break
      // A skill rests, or comes back sooner (the cooldown op), or the turn's end counts it down: its pip (update).
      case 'cooldown':
        a.cd[ev.ability] = ev.turns
        break
      case 'hexed':
        this.floating(a, 'HEXED', '#c9a6ff', 12)
        this.burst(a.sprite.x, a.sprite.y - a.chest, HEX, 8, { up: true, speed: 50 })
        break
      // A boss shrugs off a Hex: its last act was lost to one.
      case 'shrug':
        this.floating(a, 'SHRUGS OFF HEX', '#c9a6ff', 11)
        break
      case 'miss': {
        const side = (a.uid % 2 ? 1 : -1)
        if (!a.gone) this.animate(a, [{ to: { lean: -8 * side, dx: 12 * side }, ms: 90, ease: 'Quad.Out' }, { to: REST, ms: 220 }])
        this.floating(a, 'miss', '#8e8e9e')
        break
      }
      case 'phase':
        this.floating(a, `PHASE ${ev.phase + 1}`, '#ff6a7a', 16)
        this.shake(260, 0.008)
        this.flashScreen(220, 120, 20, 30)
        break
    }
  }

  // A rule at work: its name rises over the unit it acts through, in its side's colour (Ambush flares every piece of its
  // side); a NOISY one at most once a NOISY_MS per side. A side's first strike of it is also announced in the chrome.
  rule (ev) {
    const r = RULES[ev.rule]
    if (!r) return
    const mine = ev.side === 'party'
    const colour = mine ? BOON : FOE
    const key = `${ev.side}|${ev.rule}`
    const quiet = NOISY.has(ev.rule) && this.playMs - (this.noisy.get(key) ?? -Infinity) < NOISY_MS
    if (NOISY.has(ev.rule) && !quiet) this.noisy.set(key, this.playMs)
    const who = ev.rule === 'ambush' || quiet ? null : this.actors.get(RULE_ON[ev.rule] === 'actor' ? ev.actor : ev.target)
    if (who) {
      this.floating(who, r.name.toUpperCase(), mine ? '#cfe3ff' : '#ff9aaa', 11, 2)
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

  announce (r, mine) {
    this.args.hud?.announce(`${r.step} · ${r.name}`, mine)
  }

  // Dragonfire and Sanctuary have no event of their own: read off the action's targets, named on the actor.
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

  // Deadeye only sharpens a ranged blow, so it has no event: a ranged blow by a side holding it is named on the striker.
  deadeye (ev) {
    const by = this.battle.byUid.get(ev.actor)
    const at = this.battle.byUid.get(ev.targets?.[0])
    if (!by || !at || by.side === at.side || !ev.ability || !isBlow(abilityDef(ev.ability)) || abilityDef(ev.ability).melee) return
    if (holds(this.battle, by.side, 'deadeye')) this.rule({ type: 'rule', rule: 'deadeye', side: by.side, actor: ev.actor })
  }

  // A shot a screen took: its line to the piece that took it, on to the one aimed at, SCREENED over that one.
  screenedShot (ev) {
    if (ev.counter || ev.struck == null || ev.struck === ev.primary || !ev.ability || !lined(abilityDef(ev.ability))) return
    const guard = this.guarded?.beat === ev.beat && this.guarded.actor === ev.struck ? this.guarded : null
    const hit = guard ? guard.target : ev.struck
    if (hit === ev.primary) return
    const from = this.chestOf(ev.actor)
    const to = this.chestOf(hit)
    if (!from || !to) return
    const g = this.add.graphics().setDepth(9600)
    lineOfFire(g, from, to, this.chestOf(ev.primary), this.units.get(ev.actor)?.side === 'foe' ? FOE : PARTY, this.cameras.main.zoom)
    const aimed = this.actors.get(ev.primary)
    if (aimed && !aimed.gone) this.floating(aimed, 'SCREENED', '#d8d0ff', 11)
    this.tweens.add({ targets: g, alpha: 0, delay: 520, duration: 380, onComplete: () => g.destroy() })
  }

  // Canvas text at RES× so it stays sharp when the camera zooms, in the display face unless told otherwise; one edged
  // (`stroke`) is inked as the art is, an unblurred ink shadow under it (a canvas shadow ignores RES: hence the offset).
  text (x, y, str, size, colour, stroke = 0, font = DISPLAY) {
    const off = stroke ? Math.max(1, size * 0.07) : 0
    const t = this.add.text(x, y, str, {
      fontFamily: font, fontSize: `${size}px`, fontStyle: 'bold', color: colour, stroke: C.ink, strokeThickness: stroke,
      padding: off ? { left: 1, top: 1, right: Math.ceil(off) + 1, bottom: Math.ceil(off * 1.3) + 1 } : undefined
    }).setResolution(RES)
    if (off) t.setShadow(off * RES, off * 1.3 * RES, C.ink, 0, true, true)
    return t
  }

  // A banner's plate, w by h round (x, y): the panel's violet, inked, its offset under it, a rim of `edge` inside the ink.
  plate (x, y, w, h, edge) {
    const [l, t] = [-w / 2, -h / 2]
    return this.add.graphics().setPosition(x, y)
      .fillStyle(INK, 0.9).fillRoundedRect(l + 4, t + 5, w, h, 12)
      .fillStyle(PANEL, 0.95).fillRoundedRect(l, t, w, h, 12)
      .lineStyle(2, edge, 0.75).strokeRoundedRect(l + 3.5, t + 3.5, w - 7, h - 7, 9)
      .lineStyle(3, INK, 1).strokeRoundedRect(l, t, w, h, 12)
  }

  // A blow's flash: a brief pale wash screened over the struck, never a white silhouette (none if reduced).
  flash (a) {
    if (a.gone || calm) return
    a.sprite.setTint(HIT_WASH).setTintMode(Phaser.TintModes.SCREEN)
    this.time.delayedCall(60, () => a.sprite.clearTint().setTintMode(Phaser.TintModes.MULTIPLY))
  }

  // Floating text over a unit: popups stack up to FLOAT_ROWS rows, each held FLOAT_HOLD ms, waiting for a free row so
  // none covers another. `span`: the rows it takes; `side`: a status's name, in its own column right of the unit.
  floating (a, text, colour, size = 12, span = 1, side = false) {
    const now = this.time.now
    const rows = side ? (a.sideRows ??= new Array(FLOAT_ROWS).fill(0)) : (a.rows ??= new Array(FLOAT_ROWS).fill(0))
    let low = 0
    let at = Infinity
    for (let i = 0; i + span <= FLOAT_ROWS; i++) {
      const free = Math.max(now, ...rows.slice(i, i + span))
      if (free < at) { low = i; at = free }
    }
    for (let i = low; i < low + span; i++) rows[i] = at + FLOAT_HOLD
    const row = low + span - 1
    const wait = at - now
    // Legible at the zoom (a number as a number, a name as a word): the print and its rows grow together.
    const zoom = this.cameras.main.zoom
    const kind = /^[-+−×]?\d/.test(String(text)) ? 'num' : 'word'
    const k = labelScale(size, zoom, kind)
    // It pops in from a little smaller, but never from under the legible size: it reads from its first frame.
    const from = Math.min(1, Math.max(0.6, labelPx(kind) / (size * k * zoom)))
    const draw = () => {
      const t = side
        ? this.text(a.sprite.x + Math.max(22, a.sprite.displayWidth * 0.3), a.sprite.y - a.chest - 2 - SIDE_ROW * k * row, text, size * k, colour, 3).setOrigin(0, 1).setDepth(9500).setScale(from)
        : this.text(a.sprite.x, a.sprite.y - a.chest - 22 - 15 * k * row, text, size * k, colour, 3).setOrigin(0.5, 1).setDepth(9500).setScale(from)
      if (from < 1) this.tweens.add({ targets: t, scale: 1, duration: 120, ease: 'Back.Out' })
      this.tweens.add({ targets: t, y: t.y - 24, alpha: 0, delay: 160, duration: 760, ease: 'Quad.Out', onComplete: () => t.destroy() })
    }
    if (wait) this.time.delayedCall(wait, draw)
    else draw()
  }

  // The end: a banner; a loss plays a beat longer, replaying what felled the Monarch (args.death) over their half.
  finish () {
    const reason = this.battle.reason
    // No piece takes orders now: the panel says the battle is over.
    this.sel = null
    this.dropMarks()
    this.setPaused(false)
    this.ending = true
    this.changed()
    const won = this.battle.winner === 'party'
    sfx.play(won ? 'win' : 'lose')
    // Any orb still in the air (or cut short) is counted before the screen fades.
    this.time.delayedCall(1400, () => { this.purse = this.owed; this.changed() })
    const colour = won ? SOUL : FOE
    const death = !won ? this.args.death?.() ?? null : null
    // A wave a boss's fall cut short pays for the slain it had (a lost battle pays nothing).
    if (won && this.waves.length > 1) this.waves.forEach((_, k) => this.wavePaid(k))
    const clear = this.battle.floor > TUNING.run.floors ? ' The clear stands.' : ''
    // A won battle's tally: the foes slain (a shadow is none) and what the run took for them (args.earned).
    const slain = this.battle.units.filter((u) => u.side === 'foe' && !u.shadow && !alive(u)).length
    const earned = Math.round(this.args.earned?.() ?? this.owed)
    const tally = `${slain} ${slain === 1 ? 'foe' : 'foes'} slain · +${earned} essence`
    // A boss's fall crumbles its court; the Sovereign's clears the run, a floor's boss's is won as an elite is.
    const boss = this.battle.boss && this.battle.units.find((u) => u.side === 'foe' && unitDef(u.id).boss)
    const crumbled = reason === 'crumble' ? 'Its court crumbled with it. ' : ''
    const [title, line] = won ? (!boss ? ['VICTORY', tally]
      : this.battle.floor === TUNING.run.floors ? ['THE SOVEREIGN FALLS', `${crumbled}The run is cleared.`]
        : [`${unitDef(boss.id).name.toUpperCase()} FALLS`, `${crumbled}${tally}`])
      : death ? ['THE MONARCH FALLS', `${death.head}. ${death.lines.join(' ')}${clear}`]
        : reason === 'monarch' ? ['THE MONARCH FALLS', `Its retinue crumbles with it. The run is over.${clear}`]
          : ['YOUR RETINUE FALLS', 'The dead return to the dark.']
    const killer = death && reason === 'monarch' && death.from != null && death.by !== this.monarch ? death.from : null
    const crown = this.actors.get(this.monarch)
    if (killer != null && crown) this.endBeat = { from: posOf(killer), to: { x: crown.home.x, y: crown.home.y }, t0: this.time.now }
    // Over their half of the board (the left) while the blow is replayed on yours, else across the middle.
    const [x, y] = [killer != null ? -HALF_W / 2 : 0, 0]
    const z = this.cameras.main.zoom
    const width = killer != null ? HALF_W : 2 * HALF_W - 80
    const glow = this.add.image(x, y, 'glow').setTint(colour).setBlendMode(Phaser.BlendModes.ADD).setDisplaySize(620, 120).setAlpha(0).setDepth(9989)
    const banner = this.text(0, 0, title, labelSize(28, z), won ? C.soul2 : '#ff6a7a', 5).setOrigin(0.5, 0).setDepth(10000).setAlpha(0)
    const sub = this.text(0, 0, line, labelSize(11, z), '#d8d0e6', 0, FONT).setOrigin(0.5, 0).setDepth(10000).setAlpha(0)
      .setWordWrapWidth(width - 40).setAlign('center')
    const ph = banner.height + sub.height + 18
    banner.setPosition(x, y - ph / 2 + 6)
    sub.setPosition(x, banner.y + banner.height + 2)
    const plate = this.plate(x, y, Math.max(width, banner.width + 60), Math.max(70, ph), colour).setDepth(9990).setAlpha(0)
    this.tweens.add({ targets: [plate, banner, sub], alpha: 1, duration: 260 })
    this.tweens.add({ targets: glow, alpha: 0.5, duration: 400 })
    this.time.delayedCall(death ? 3600 : 1600, () => {
      this.cameras.main.fadeOut(260, 6, 5, 10)
      this.cameras.main.once('camerafadeoutcomplete', () => this.skip())
    })
  }

  // Each frame of a lost battle's replay beat: the blow drawn from the killer's tile to the Monarch's, both ringed.
  drawEnd (time) {
    const e = this.endBeat
    if (!e) return
    const g = (this.endG ??= this.add.graphics().setDepth(9300))
    const f = Math.min(1, (time - e.t0) / 360)
    const v = calm ? 0.8 : 0.6 + 0.4 * Math.sin((time - e.t0) / 160)
    g.clear()
    const at = (p) => ({ x: p.x, y: p.y - 24 })
    const [a, b] = [at(e.from), at(e.to)]
    const tip = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    g.lineStyle(9, FOE, 0.25).lineBetween(a.x, a.y, tip.x, tip.y)
    inked(g, 3, 0xffc0c8, 0.95, (g) => g.lineBetween(a.x, a.y, tip.x, tip.y))
    inked(g, 3, FOE, v, (g) => g.strokeEllipse(e.from.x, e.from.y + 4, 70, 22))
    inked(g, 3, GOLD, v, (g) => g.strokeEllipse(e.to.x, e.to.y + 4, 74, 24))
  }
}
