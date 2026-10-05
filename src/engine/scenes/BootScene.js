// Loads the baked atlas and its animations, then waits for a battle.
import Phaser from 'phaser'
import atlasPng from '../../assets/atlas-0.png?url'
import atlasData from '../../assets/atlas-0.json'
import anims from '../../assets/anims.json'

export const TEXTURE = 'units'

export class BootScene extends Phaser.Scene {
  constructor () { super('Boot') }

  preload () {
    this.load.atlas(TEXTURE, atlasPng, atlasData)
    this.load.on('loaderror', (file) => console.error('failed to load', file.key, file.src))
  }

  create () {
    for (const a of anims) {
      if (this.anims.exists(a.key)) continue
      this.anims.create({
        key: a.key,
        frames: a.frames.map((frame) => ({ key: TEXTURE, frame })),
        frameRate: a.frameRate,
        repeat: a.repeat
      })
    }
    this.registry.get('ready')?.()
  }
}
