// The only place a Phaser Game is constructed (§8).
//
// Note what is absent: there is no `physics` key in the config at all. The simulation is a
// deterministic stat engine and the renderer is a playback device, so a physics world would have
// nothing to do and everything to break.

import Phaser from 'phaser'
import { BootScene } from './scenes/BootScene.js'
import { DungeonScene } from './scenes/DungeonScene.js'
import { BattleScene } from './scenes/BattleScene.js'
import { HudScene } from './scenes/HudScene.js'

/**
 * @param {string|HTMLElement} parent
 * @param {object} sim  the already-loaded game: {kernel, tuning, packs, report, seed}
 */
export function startGame (parent, sim) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: '#0b0a0e',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: '100%',
      height: '100%'
    },
    // Content is loaded and frozen before Phaser exists, so scenes can never mutate it.
    callbacks: { preBoot: (game) => game.registry.set('sim', sim) },
    scene: [BootScene, DungeonScene, BattleScene, HudScene]
  })
}
