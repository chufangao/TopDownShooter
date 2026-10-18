// The pictures a battle draws: the scene that loads the unit and prop pictures and makes the FX textures, a
// shadow's washed pictures, and a kind drawn as more than its picture (artOf).
import Phaser from '../vendor/phaser.js'
import { UNIT_LIST, artUrl, ART_POSES } from '../content.js'
import { FEET, figures, plainFigure, WASH } from '../dom.js'

// The pictures are SVG, rasterised once at RES× their size so they stay sharp when the camera zooms in. A unit's are
// `unit:<art>:alive`, `:attack` and `:dead`; its feet stand at FEET of its height.
export const RES = 3
const prop = (name) => new URL(`../assets/props/${name}.svg`, import.meta.url).href
export const WALLS = ['wall-0', 'wall-1', 'wall-2']
export const WALL_FOOT = 80 / 96 // a wall picture's ground line

export class BootScene extends Phaser.Scene {
  constructor () { super('Boot') }

  preload () {
    for (const u of UNIT_LIST) {
      for (const pose of ART_POSES) this.load.svg(`unit:${u.art}:${pose}`, artUrl(u.id, pose), { scale: RES })
    }
    for (const w of WALLS) this.load.svg(w, prop(w), { scale: RES })
    this.load.svg('floor', prop('floor'), { scale: 2 })
    this.load.on('loaderror', (file) => console.error('failed to load', file.key, file.src))
  }

  create () {
    makeTextures(this)
    this.registry.get('ready')?.()
  }
}

// Soft FX textures drawn once on canvases: a radial glow, a small spark, and the vignette over the floor.
function makeTextures (scene) {
  const canvas = (key, w, hgt, draw) => {
    if (scene.textures.exists(key)) return
    const t = scene.textures.createCanvas(key, w, hgt)
    draw(t.getContext(), w, hgt)
    t.refresh()
    t.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
  const radial = (ctx, w, stops) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    for (const [at, c] of stops) g.addColorStop(at, c)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, w)
  }
  canvas('glow', 64, 64, (ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.45)'], [1, 'rgba(255,255,255,0)']]))
  canvas('spark', 16, 16, (ctx, w) => radial(ctx, w, [[0, 'rgba(255,255,255,1)'], [0.5, 'rgba(255,255,255,.7)'], [1, 'rgba(255,255,255,0)']]))
  // A crescent for blade swings: the gap between two offset circles, brightest at its belly.
  canvas('slash', 128, 128, (ctx, w) => {
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.75, 'rgba(255,255,255,.9)')
    g.addColorStop(1, 'rgba(255,255,255,1)')
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(w / 2, w / 2, w * 0.46, 0, Math.PI * 2); ctx.fill()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath(); ctx.arc(w / 2 - w * 0.1, w / 2, w * 0.44, 0, Math.PI * 2); ctx.fill()
  })
  canvas('vignette', 512, 512, (ctx, w) => radial(ctx, w, [[0, 'rgba(6,5,10,0)'], [0.55, 'rgba(6,5,10,.25)'], [1, 'rgba(6,5,10,.96)']]))
}

// A shadow's pictures, `shade:<art>:<pose>`: the unit's own, drained of colour and washed a cold grave-green (made on
// first use, alpha kept). A shadow on their side is `shadefoe:`, washed a bruised rose instead.
const SHADE_WASH = {
  shade: (l) => [0.5 * l + 10, 0.92 * l + 34, 0.7 * l + 24],
  shadefoe: (l) => [0.9 * l + 34, 0.5 * l + 12, 0.78 * l + 36]
}
export function shadeTextures (scene, art, skin = 'shade') {
  for (const pose of ART_POSES) {
    const key = `${skin}:${art}:${pose}`
    if (scene.textures.exists(key)) continue
    const src = scene.textures.get(`unit:${art}:${pose}`).getSourceImage()
    const t = scene.textures.createCanvas(key, src.width, src.height)
    const ctx = t.getContext()
    ctx.drawImage(src, 0, 0)
    const img = ctx.getImageData(0, 0, src.width, src.height)
    const px = img.data
    for (let i = 0; i < px.length; i += 4) {
      const [r, g, b] = SHADE_WASH[skin](0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2])
      px[i] = Math.min(255, r)
      px[i + 1] = Math.min(255, g)
      px[i + 2] = Math.min(255, b)
    }
    ctx.putImageData(img, 0, 0)
    t.refresh()
    t.setFilter(Phaser.Textures.FilterMode.LINEAR)
  }
}

// The art kind `id`'s textures go by: its picture's, or for a kind drawn as more than its picture (a trine's three
// figures, a boss's bigger) its own id, made on first use from its figures' as one, the front one's feet at FEET.
export function artOf (scene, id) {
  if (plainFigure(id)) return figures(id)[0].art
  if (!scene.textures.exists(`unit:${id}:alive`)) for (const pose of ART_POSES) drawFigures(scene, `unit:${id}:${pose}`, figures(id), pose)
  return id
}

function drawFigures (scene, key, figs, pose) {
  const src = (f) => scene.textures.get(`unit:${f.art}:${pose}`).getSourceImage()
  const H = Math.max(...figs.map((f) => src(f).height * Math.max(1, f.k)))
  const half = Math.max(...figs.map((f) => Math.abs(f.x) * H + f.k * src(f).width / 2))
  const t = scene.textures.createCanvas(key, Math.ceil(2 * half), H)
  const ctx = t.getContext()
  for (const f of figs) {
    const img = src(f)
    const [w, h] = [img.width * f.k, img.height * f.k]
    const [x, y] = [t.width / 2 + f.x * H - w / 2, FEET * H + f.y * H - FEET * h]
    if (f.dim === 1 && !f.wash) { ctx.drawImage(img, x, y, w, h); continue }
    // Washed (WASH's matrix on every pixel) and darkened (black over it at 1 − dim) apart, then laid in place.
    const c = document.createElement('canvas')
    c.width = Math.ceil(w)
    c.height = Math.ceil(h)
    const g = c.getContext('2d', { willReadFrequently: f.wash })
    g.drawImage(img, 0, 0, w, h)
    if (f.wash) {
      const data = g.getImageData(0, 0, c.width, c.height)
      const px = data.data
      for (let i = 0; i < px.length; i += 4) {
        const [r, gr, b] = [px[i], px[i + 1], px[i + 2]]
        for (let k = 0; k < 3; k++) px[i + k] = Math.min(255, WASH[5 * k] * r + WASH[5 * k + 1] * gr + WASH[5 * k + 2] * b)
      }
      g.putImageData(data, 0, 0)
    }
    if (f.dim < 1) {
      g.globalCompositeOperation = 'source-atop'
      g.fillStyle = `rgba(0, 0, 0, ${1 - f.dim})`
      g.fillRect(0, 0, c.width, c.height)
    }
    ctx.drawImage(c, x, y)
  }
  t.refresh()
  t.setFilter(Phaser.Textures.FilterMode.LINEAR)
}
