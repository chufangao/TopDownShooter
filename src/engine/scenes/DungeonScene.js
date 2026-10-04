// The leader walks a generated floor, the party trails behind (§6, M0).
//
// No physics, no collision system: the floor is a tile array the sim generated and proved
// walkable, and the scene tweens sprites between tile centres.
//
// **This scene decides nothing.** The run lives in `sim/run.js`: it owns the floor, the route, the
// battles, recovery, XP and recruitment, and `arriveAt()` hands back a finished report. Everything
// here is playback — the same contract BattleScene has with the event timeline, one loop up (§8).

import Phaser from 'phaser'
import { TILE } from '../../sim/dungeon.js'
import { createRun } from '../../sim/run.js'
import { tagSummary } from '../../sim/synergy.js'

const TILE_PX = 16
const STEP_MS = 135
const PAUSE_MS = 420

const NODE_COLOUR = {
  encounter: 0xd05c5c,
  elite: 0xe8b04b,
  treasure: 0xe8d84b,
  shrine: 0x9b7be0,
  merchant: 0x4bc0e8,
  campfire: 0xef8f34,
  rare: 0x7be0a0,
  secret: 0x8e8e9e,
  boss: 0xff4d4d,
  exit: 0x7be0a0
}

const px = (t) => t * TILE_PX + TILE_PX / 2

export class DungeonScene extends Phaser.Scene {
  constructor () { super('Dungeon') }

  create () {
    this.sim = this.registry.get('sim')
    this.speed = 1
    this.held = false
    this.parked = false
    this.newRun()

    this.cameras.main.setBackgroundColor('#0b0a0e')
    this.scene.launch('Hud')

    // Speed is a *view* control, not an input into the game — the run plays itself either way (§1).
    this.input.keyboard.on('keydown', (e) => {
      const n = { Digit1: 1, Digit2: 2, Digit4: 4, Digit8: 8 }[e.code]
      if (n) this.setSpeed(n)
      if (e.code === 'KeyR') this.reroll()
    })

    this.enterFloor()
  }

  setSpeed (n) {
    this.speed = n
    this.anims.globalTimeScale = n
    this.publish()
  }

  reroll () {
    this.sim.seed = String(Date.now())   // a view-level convenience for looking at floors
    this.newRun()
    this.enterFloor()
  }

  newRun () {
    this.run = createRun({
      kernel: this.sim.kernel,
      tuning: this.sim.tuning,
      seed: this.sim.seed,
      // The player's policy, and the instrumentation that makes it legible (§4, §4.1). The scene
      // hands all three to the run and then never touches any of them again — the ledger least of
      // all, since it outlives every run this scene will ever create (§4.3).
      doctrine: this.sim.doctrine,
      trace: this.sim.trace,
      signals: this.sim.signals
    })
    this.pendingDoctrine = null
    this.lastRecruit = null
    this.lastLevel = null
  }

  /**
   * Hold the walk at the next node boundary. A *view* control, like ×1–×8: the run has resolved
   * nothing past the node the party is standing on, so this pauses the camera and not the game (§1).
   */
  hold (on) {
    this.held = !!on
    if (!on && this.parked) { this.parked = false; this.resume(); return }
    this.publish()
  }

  /**
   * Take a rewritten Doctrine. It is queued rather than applied, because the current node may be a
   * battle whose timeline the sim has already decided — swapping policy underneath a playback would
   * make the screen show a fight that was resolved by different rules (§8).
   */
  adopt (doctrine) {
    this.pendingDoctrine = doctrine
    this.publish()
  }

  /** The run's roster, which the scene reads and never writes. */
  get roster () { return this.run.state.roster }

  // ── floor ────────────────────────────────────────────────────────────────────────────────────

  enterFloor () {
    this.run.enterFloor()
    this.drawFloor()
  }

  /** Draw whatever floor the run is currently standing on. Never generates one. */
  drawFloor () {
    // Full teardown: a floor left half-alive is how a 20-floor run turns into a memory leak and a
    // stray tween that moves a destroyed sprite.
    this.tweens.killAll()
    this.time.removeAllEvents()
    this.children.removeAll(true)
    this.map?.destroy()
    this.map = null
    this.layer = null

    const floor = this.run.floor
    this.buildTiles(floor)
    this.buildNodes(floor)
    this.buildParty(floor)

    const worldW = floor.w * TILE_PX
    const worldH = floor.h * TILE_PX
    this.cameras.main.setBounds(0, 0, worldW, worldH)
    this.cameras.main.setZoom(2)
    this.cameras.main.startFollow(this.party[0].sprite, true, 0.09, 0.09)
    this.cameras.main.fadeIn(280, 8, 7, 12)

    // The route is the run's decision (§4, Route/Risk); the scene only turns its legs into tiles
    // to walk and marks which leg ends on a node.
    this.steps = []
    for (const leg of this.run.route) {
      const rest = leg.path.slice(1)
      rest.forEach((p, i) => this.steps.push({ ...p, arrive: i === rest.length - 1 ? leg.to : null }))
    }
    this.stepIndex = 0
    this.publish()
    this.time.delayedCall(320, () => this.stepOnce())
  }

  buildTiles (d) {
    // Node tiles render as plain floor; the markers are separate objects so visiting one is a
    // sprite to destroy rather than a tilemap to mutate.
    const data = []
    for (let y = 0; y < d.h; y++) {
      const row = []
      for (let x = 0; x < d.w; x++) {
        const t = d.tiles[y * d.w + x]
        row.push(t === TILE.NODE ? TILE.FLOOR : t)
      }
      data.push(row)
    }

    const map = this.make.tilemap({ data, tileWidth: TILE_PX, tileHeight: TILE_PX })
    const tileset = map.addTilesetImage('crypt', 'core:tileset_crypt', TILE_PX, TILE_PX)
    // TilemapGPULayer is new in v4: fixed rendering cost per pixel regardless of tile count (§8).
    this.layer = map.createLayer(0, tileset, 0, 0, true) ?? map.createLayer(0, tileset, 0, 0)
    this.layer.setDepth(-1000)
    this.map = map
  }

  buildNodes (d) {
    this.markers = new Map()
    for (const n of d.nodes) {
      const colour = NODE_COLOUR[n.type] ?? 0xffffff
      const marker = this.add.rectangle(px(n.x), px(n.y), 7, 7, colour)
        .setAngle(45)
        .setDepth(px(n.y) - 1)
        .setAlpha(0.9)
      this.tweens.add({
        targets: marker, scale: { from: 0.75, to: 1.15 }, alpha: { from: 0.6, to: 1 },
        duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut'
      })
      this.markers.set(`${n.x},${n.y}`, marker)
    }

    const exit = this.add.rectangle(px(d.exit.x), px(d.exit.y), 11, 11)
      .setStrokeStyle(1, 0x7be0a0, 0.8)
      .setDepth(-900)
    this.tweens.add({ targets: exit, scale: { from: 1, to: 1.35 }, alpha: { from: 0.9, to: 0.2 }, duration: 1400, repeat: -1 })
  }

  buildParty (d) {
    this.party = this.roster.map((inst) => {
      const def = this.sim.kernel.registry.get('unit', inst.defId)
      const texture = `${def.id.split(':')[0]}:units`
      const sprite = this.add.sprite(px(d.entry.x), px(d.entry.y), texture, `${def.id}/idle/0`)
      sprite.setOrigin(0.5, 0.86).setScale(0.55).setDepth(px(d.entry.y))
      sprite.play(`${def.id}/idle`)
      if (inst.hp <= 0) sprite.setAlpha(0.3)
      return { def, inst, sprite }
    })
    // The party follows the leader as a trailing sprite chain — cheap, and it makes a 12-unit
    // party legible while walking (§6).
    this.trail = this.party.map(() => ({ ...d.entry }))
  }

  // ── walking ──────────────────────────────────────────────────────────────────────────────────

  stepOnce () {
    if (!this.scene.isActive()) return
    if (this.stepIndex >= this.steps.length) return this.descend()

    const step = this.steps[this.stepIndex++]
    this.trail.unshift({ x: step.x, y: step.y })
    this.trail.length = this.party.length

    const duration = STEP_MS / this.speed
    this.party.forEach((m, j) => {
      const target = this.trail[Math.min(j, this.trail.length - 1)]
      const tx = px(target.x)
      const ty = px(target.y)
      if (tx !== m.sprite.x) m.sprite.setFlipX(tx < m.sprite.x)
      this.playClip(m, 'walk')
      this.tweens.add({
        targets: m.sprite,
        x: tx,
        y: ty,
        duration,
        ease: 'Linear',
        onUpdate: () => m.sprite.setDepth(m.sprite.y),
        onComplete: j === 0 ? () => this.onLeaderArrived(step) : undefined
      })
    })
  }

  onLeaderArrived (step) {
    if (!step.arrive) return this.stepOnce()

    const marker = this.markers.get(`${step.arrive.x},${step.arrive.y}`)
    if (marker) {
      this.markers.delete(`${step.arrive.x},${step.arrive.y}`)
      this.tweens.add({ targets: marker, scale: 2.4, alpha: 0, duration: 260, onComplete: () => marker.destroy() })
    }

    this.currentNode = step.arrive.type
    this.publish()
    for (const m of this.party) this.playClip(m, 'idle')
    this.floatLabel(step.arrive)

    // ★ The node resolves here, in the sim, before a single frame of it is drawn — battle included.
    // What comes back is a finished report, and the rest of this scene only shows it.
    const report = this.run.arriveAt(step.arrive)
    this.describe(report)

    // Dispatches were raised by the run, after the node resolved (§4.1). Handing them to the UI is
    // playback like everything else here — the scene neither decides that a report is due nor what
    // it says, and an ignored one changes nothing about what happens next.
    if (report.dispatches?.length) this.sim.onDispatches?.(report.dispatches)

    if (report.battle) {
      this.time.delayedCall(220 / this.speed, () => this.showBattle(report))
      return
    }

    if (report.healed > 0) {
      this.party.forEach((m) => { m.sprite.setAlpha(m.inst.hp > 0 ? 1 : 0.3); this.pip(m) })
    }
    this.publish()
    if (this.run.state.over) return this.finish()
    this.time.delayedCall(PAUSE_MS / this.speed, () => this.resume())
  }

  // ── the cut to the battle screen (§1, loop A) ────────────────────────────────────────────────

  /** Hand the finished timeline to the player scene. Nothing about the outcome is still open. */
  showBattle (report) {
    this.scene.setVisible(false)
    this.scene.get('Hud').scene.setVisible(false)
    this.scene.pause()
    this.scene.launch('Battle', {
      result: report.battle.result,
      floor: this.run.state.floorNum,
      speed: this.speed,
      onDone: () => this.afterBattle(report)
    })
  }

  afterBattle (report) {
    this.scene.setVisible(true)
    this.scene.get('Hud').scene.setVisible(true)
    this.scene.resume()
    this.cameras.main.fadeIn(200, 8, 7, 12)

    if (this.run.state.over) return this.finish()

    // Recruits need sprites, and the chain needs to be long enough to hold them.
    this.rebuildParty()
    this.publish()
    this.time.delayedCall(200 / this.speed, () => this.resume())
  }

  /**
   * The node boundary — the one moment when nothing is mid-flight, so it is where both the hold and
   * a rewritten Doctrine take effect.
   */
  resume () {
    this.currentNode = null

    if (this.pendingDoctrine) {
      this.run.setDoctrine(this.pendingDoctrine)
      this.pendingDoctrine = null
    }

    if (this.held) {
      this.parked = true
      this.publish()
      return
    }
    this.stepOnce()
  }

  /** Turn a node report into the two HUD lines. Formatting only — no state changes live here. */
  describe (report) {
    const name = (u) => this.sim.kernel.registry.get('unit', u.defId).name

    this.lastLevel = report.levelled.length
      ? report.levelled.map((a) => `${name(a)} →${a.to}`).join(', ')
      : null

    this.lastRecruit = report.joined.length
      ? `+${report.joined.map(name).join(', ')}` +
        (report.cut.length ? ` (cut ${report.cut.map(name).join(', ')})` : '')
      : report.declined.length
        ? `declined ${report.declined.length} — party full and nothing to cut`
        : report.revived
          ? `${report.revived} back on their feet`
          : null
  }

  /** Rebuild the walking chain in place, keeping everyone where they already stand. */
  rebuildParty () {
    const at = this.trail[0] ?? this.run.floor.entry
    for (const m of this.party) m.sprite.destroy()
    this.buildParty({ entry: at })
    this.trail = this.roster.map((_, i) => ({ ...(this.trail[Math.min(i, this.trail.length - 1)] ?? at) }))
  }

  /**
   * The run ended — a wipe, or the boss on the bottom floor. Which it was, and what it paid, are
   * both decided by the sim: `run.finish()` prices it once and the scene reads `state.banked`
   * (§18.15). It used to be `wipe()`, which quietly assumed the only way out was down.
   */
  finish () {
    const banked = this.run.finish()
    // What the run discovered, handed to the profile that spends it (§5). The sim decided which
    // keys are new; this only carries them across.
    this.sim.onDiscover?.(banked.codex)
    const how = this.run.state.reason === 'boss'
      ? `the Hollow Sovereign falls on floor ${this.run.state.deepest}`
      : `party wiped on floor ${this.run.state.floorNum}`
    this.currentNode = `${how} — ${banked.residue} Residue banked — new run`
    this.publish()
    this.time.delayedCall(1400, () => {
      this.newRun()
      this.enterFloor()
    })
  }

  pip (member) {
    const dot = this.add.circle(member.sprite.x, member.sprite.y - 16, 2, 0x7be0a0).setDepth(9400)
    this.tweens.add({ targets: dot, y: dot.y - 10, alpha: 0, duration: 600, onComplete: () => dot.destroy() })
  }

  floatLabel (node) {
    const label = this.add.text(px(node.x), px(node.y) - 22, node.type, {
      fontFamily: 'ui-monospace, monospace', fontSize: '8px',
      color: '#' + (NODE_COLOUR[node.type] ?? 0xffffff).toString(16).padStart(6, '0'),
      // The walls are the light value here, so labels need their own dark edge to stay readable.
      stroke: '#07060b',
      strokeThickness: 3
    }).setOrigin(0.5, 1).setDepth(9000).setResolution(3)
    this.tweens.add({
      targets: label, y: label.y - 12, alpha: { from: 1, to: 0 },
      duration: 900 / this.speed, onComplete: () => label.destroy()
    })
  }

  playClip (member, key) {
    const anim = `${member.def.id}/${key}`
    if (member.sprite.anims.currentAnim?.key !== anim && this.anims.exists(anim)) member.sprite.play(anim)
  }

  descend () {
    for (const m of this.party) this.playClip(m, 'idle')
    this.currentNode = 'descending'
    this.publish()
    this.cameras.main.fadeOut(320, 8, 7, 12)
    this.cameras.main.once('camerafadeoutcomplete', () => {
      // `descend` advances the run onto a freshly generated floor; the scene only redraws it.
      this.run.descend()
      this.drawFloor()
    })
  }

  /** The HUD is a separate scene so it renders unzoomed; state travels through the registry. */
  publish () {
    this.registry.set('hud', {
      floor: this.run.state.floorNum,
      visited: this.run.state.visited,
      total: this.run.floor?.nodes.length ?? 0,
      node: this.parked ? 'held — editing the Doctrine' : this.currentNode,
      speed: this.speed,
      pending: !!this.pendingDoctrine,
      party: (this.party ?? []).map((m) => ({ name: m.def.name, hp: m.inst.hp, maxHp: m.inst.maxHp, lvl: m.inst.lvl })),
      tags: this.roster ? tagSummary(this.sim.kernel.registry, this.roster) : [],
      recruit: this.lastRecruit,
      level: this.lastLevel,
      seed: this.sim.seed
    })
  }
}
