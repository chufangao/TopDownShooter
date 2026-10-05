// The only place a Phaser Game is constructed. The canvas is used for battles only.
import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene.js'
import { BattleScene } from './scenes/BattleScene.js'

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
    // data: { battle, title, barHeight(), onChange(state), onDone() }. Resolves with the scene once it is built.
    async battle (data) {
      await loaded
      return new Promise((resolve) => game.scene.start('Battle', { ...data, onReady: resolve }))
    }
  }
}
