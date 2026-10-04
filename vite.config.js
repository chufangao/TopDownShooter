import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    // packs/ sits beside src/ and is served in dev by the same glob that bundles it for a build,
    // so the pack loader has exactly one input shape either way (§13.1).
    watch: { ignored: ['**/node_modules/**', '**/.git/**'] }
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0   // baked atlases stay real files — they should be cacheable and diffable
  }
})
