// A separate, unzoomed scene for the overlay — the dungeon camera runs at ×2, and text should not.
//
// Everything here is read-only. There is no control to render because the player never inputs
// anything (§1); ×1–×8 is a view speed, and the Doctrine panel is plain DOM above the canvas
// rather than a scene, because it is a form over a JSON tree and wants focus and scrolling (§8).

import Phaser from 'phaser'

const PANEL = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '12px', color: '#cfc9bd' }
const DIM = { ...PANEL, color: '#6e6a63' }

export class HudScene extends Phaser.Scene {
  constructor () { super('Hud') }

  create () {
    // The dungeon walls are the light value in the crypt palette, so the overlay needs its own
    // ground rather than relying on the map behind it being dark.
    this.plate = this.add.rectangle(0, 0, 10, 72, 0x07060b, 0.72).setOrigin(0, 0)
    this.title = this.add.text(12, 10, '', { ...PANEL, color: '#e8b04b' }).setResolution(2)
    this.status = this.add.text(12, 28, '', PANEL).setResolution(2)
    this.party = this.add.text(12, 50, '', DIM).setResolution(2)
    this.footPlate = this.add.rectangle(0, 0, 10, 26, 0x07060b, 0.72).setOrigin(0, 0)
    this.hint = this.add.text(12, 0, 'tab — doctrine · 1 2 4 8 — speed · R — reroll the run', DIM).setResolution(2)
    this.scale.on('resize', () => this.layout())
    this.layout()
  }

  layout () {
    this.hint.setY(this.scale.height - 22)
    this.footPlate.setPosition(0, this.scale.height - 28).setSize(this.scale.width, 28)
    this.plate.setSize(this.scale.width, 72)
  }

  update () {
    const h = this.registry.get('hud')
    if (!h) return
    this.title.setText(`RETINUE — FLOOR ${h.floor}`)
    this.status.setText(
      `nodes ${h.visited}/${h.total}` +
      (h.node ? `   ▸ ${h.node}` : '') +
      (h.pending ? '   ▸ new doctrine at the next node' : '') +
      `   ×${h.speed}   seed ${h.seed}`
    )
    this.party.setText(
      'party: ' + h.party.map((u) => `${u.name} L${u.lvl ?? 1} ${u.hp}/${u.maxHp}`).join(' · ') +
      (h.tags?.length ? `\nsynergy: ${h.tags.join(' · ')}` : '') +
      (h.level ? `\nlevel up: ${h.level}` : '') +
      (h.recruit ? `\n${h.recruit}` : '')
    )
    this.plate.setSize(Math.max(this.status.width, this.party.width) + 24, 62 + this.party.height)
  }
}
