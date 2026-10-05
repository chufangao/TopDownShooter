import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000   // Phaser alone is ~1.4 MB
  }
})
