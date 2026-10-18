// The coach: the tutorial's one callout, a line beside what to do next with an arrow at it, kept beside its target
// while the target moves (a board that pans, a piece that walks); a DOM target pulses too.
import { h, fill } from '../dom.js'
import { frame, toLocalRect } from '../frame.js'

const el = h('div', { class: 'coach', role: 'status', 'aria-live': 'polite' })
let target = null
let marked = null
let raf = 0
if (frame.el) frame.el.append(el)

// The target as a rect in the frame's px: an element, a { left, top, right, bottom } rect in viewport px, or a function
// returning either, read every frame (null: nothing to point at yet).
const rectOf = () => {
  const t = typeof target === 'function' ? target() : target
  if (!t) return null
  return toLocalRect(t.getBoundingClientRect ? t.getBoundingClientRect() : t)
}

// Above the target where there is room, else below; centred on it within the frame, the arrow at its centre.
function place () {
  const r = rectOf()
  if (!r || (r.width === 0 && r.height === 0)) { el.classList.remove('on'); return }
  el.classList.add('on')
  const w = el.offsetWidth
  const ht = el.offsetHeight
  const gap = 12
  const cx = (r.left + r.right) / 2
  const above = r.top - gap - ht >= 8
  const x = Math.min(Math.max(8, cx - w / 2), frame.w - w - 8)
  const y = above ? r.top - gap - ht : Math.min(r.bottom + gap, frame.h - ht - 8)
  el.dataset.side = above ? 'above' : 'below'
  el.style.left = `${Math.round(x)}px`
  el.style.top = `${Math.round(y)}px`
  el.style.setProperty('--ax', `${Math.round(Math.min(Math.max(16, cx - x), w - 16))}px`)
}

const mark = (t) => {
  const next = t && typeof t !== 'function' && t.classList ? t : null
  if (marked === next) return
  marked?.classList.remove('coach-target')
  marked = next
  marked?.classList.add('coach-target')
}

export const coach = {
  // Points at `at` with `text`; shown again with the same target it only changes its words.
  show ({ at, text }) {
    if (target === at && el.textContent === text) return
    target = at
    fill(el, text)
    mark(at)
    cancelAnimationFrame(raf)
    const tick = () => {
      if (target !== at) return
      place()
      raf = requestAnimationFrame(tick)
    }
    tick()
  },
  hide () {
    target = null
    cancelAnimationFrame(raf)
    el.classList.remove('on')
    mark(null)
  }
}
