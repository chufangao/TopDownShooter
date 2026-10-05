import atlasPng from '../assets/atlas-0.png?url'
import atlas from '../assets/atlas-0.json'
import { unitDef } from '../content/index.js'

// h('div', { class: 'x', onclick }, ...children)
export function h (tag, attrs, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'class') el.className = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : String(c))
  return el
}

const frames = new Map(atlas.frames.map((f) => [f.filename, f.frame]))
const { w: AW, h: AH } = atlas.meta.size

// A unit's first idle frame, cut from the battle atlas.
export function portrait (id, size = 32) {
  const f = frames.get(`${unitDef(id).art}/idle/0`)
  const k = size / f.w
  return h('span', {
    class: 'portrait',
    style: `width:${size}px;height:${size}px;background-image:url(${atlasPng});` +
      `background-size:${AW * k}px ${AH * k}px;background-position:${-f.x * k}px ${-f.y * k}px`
  })
}

export function hpBar (u) {
  const pct = Math.max(0, Math.min(1, u.hp / u.maxHp))
  return h('span', { class: 'hpbar' + (pct <= 0 ? ' dead' : pct < 0.35 ? ' low' : '') },
    h('span', { style: `width:${pct * 100}%` }))
}
