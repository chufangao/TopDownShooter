// Load the baked art and nothing else (§15).
//
// The game at runtime only ever loads finished atlases — it never generates. Animations are read
// from the generated `anims.json`, so there is no hand-authored animation config anywhere in the
// engine: adding a unit is one descriptor and one `npm run art`.

import Phaser from 'phaser'
import { assetUrl } from '../packsource.browser.js'

export class BootScene extends Phaser.Scene {
  constructor () { super('Boot') }

  preload () {
    const { packs } = this.registry.get('sim')
    this.artManifests = []

    for (const pack of packs) {
      const baked = (pack.manifest.art?.baked ?? '').replace(/\/?$/, '/')
      if (!baked || !pack.has(baked + 'manifest.json')) continue
      const m = pack.json(baked + 'manifest.json')

      const image = assetUrl(pack.id, baked + m.atlas.image)
      if (image) {
        // The third argument accepts a well-formed atlas object, so the atlas JSON travels through
        // the pack loader like every other file rather than being fetched a second time.
        this.load.atlas(`${pack.id}:units`, image, pack.json(baked + m.atlas.data))
      }
      for (const [id, t] of Object.entries(m.tiles ?? {})) {
        const url = assetUrl(pack.id, baked + t.file)
        if (url) this.load.image(id, url)
      }
      this.artManifests.push({ pack, baked, manifest: m })
    }

    this.load.on('loaderror', (file) => console.error('failed to load', file.key, file.src))
  }

  create () {
    let created = 0
    for (const { pack, baked } of this.artManifests) {
      const texture = `${pack.id}:units`
      if (!this.textures.exists(texture)) continue
      for (const anim of pack.json(baked + 'anims.json')) {
        if (this.anims.exists(anim.key)) continue
        this.anims.create({
          key: anim.key,
          frames: anim.frames.map((frame) => ({ key: texture, frame })),
          frameRate: anim.frameRate,
          repeat: anim.repeat
        })
        created++
      }
    }
    console.log(`art: ${created} animations from ${this.artManifests.length} pack(s)`)
    this.scene.start('Dungeon')
  }
}
