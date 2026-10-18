// Phaser, for battles only: the one Game, its boot scene (pictures, FX textures) and the battle scene, and the barrel
// of src/engine/. It decides nothing: the player's taps go to the run as orders and the events each made play back.
import Phaser from './vendor/phaser.js'
import { BootScene } from './engine/textures.js'
import { BattleScene } from './engine/scene.js'

export * from './engine/palette.js'
export * from './engine/textures.js'
export * from './engine/marks.js'
export * from './engine/geometry.js'
export * from './engine/timeline.js'
export * from './engine/scene.js'
// For the Field board, which draws the very board a battle plays on.
export { FEET } from './dom.js'

// ── engine and picture loading ───────────────────────────────────────────────────────────────────

// `gate`: what else the board waits on before it draws (the display face, so no canvas text is set in another).
export function createEngine (parent, { gate = null } = {}) {
  let ready
  const pictures = new Promise((resolve) => { ready = resolve })
  const loaded = gate ? Promise.all([pictures, gate]) : pictures
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0f0b17',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    callbacks: { preBoot: (g) => g.registry.set('ready', ready) },
    scene: [BootScene, BattleScene]
  })
  return {
    game,
    // Resolves once the pictures are loaded and the gate is through.
    ready: loaded,
    // data: { battle (run.battle), order(o) (applies an order, returns its events; throws on an illegal one), title,
    // stage() (the viewport rect the board fits in), hud (the chrome's words), onChange(state), onHover(unit | null,
    // rect, pin), onDone(), essence (the purse's multiplier on a slain foe's essence), seamless (no fade in from black),
    // death() (what felled the Monarch, or null), elite, earned() (the battle's essence, for the VICTORY banner),
    // met(id) (a foe kind met: its reach is drawn), resume (a saved battle: its orders replayed out of sight) }.
    // Resolves with the scene once built.
    async battle (data) {
      await loaded
      return new Promise((resolve) => game.scene.start('Battle', { ...data, onReady: resolve }))
    }
  }
}
