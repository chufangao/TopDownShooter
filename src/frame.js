// The frame: the DOM interface laid out at one logical size and scaled whole to the screen, one landscape layout from
// desktop to phone. Only #frame is scaled; the Phaser canvas keeps viewport pixels, so two spaces meet here: viewport px
// (clientX/clientY, getBoundingClientRect(), board.rectOf/tileAt) and logical px (every CSS length inside #frame);
// toLocal takes one to the other. CSS reads --frame-w, --frame-h, --frame-k, --frame-x, --frame-y; #frame is the size
// container `frame`, for @container frame (max-height: …).

const H = 720
const H_MIN = 540
const MIN_W = 960 // 4:3 of H; a shorter frame keeps 4:3 of its own height

// k: viewport px per logical px; x, y: its top left in the viewport; w, h: its logical size; el: #frame, where
// anything positioned over the page (a tooltip, an overlay, a drag's ghost) is appended.
export const frame = { k: 1, x: 0, y: 0, w: MIN_W, h: H, el: null }

export const toLocal = (x, y) => ({ x: (x - frame.x) / frame.k, y: (y - frame.y) / frame.k })
export function toLocalRect (r) {
  const a = toLocal(r.left, r.top)
  const b = toLocal(r.right, r.bottom)
  return { left: a.x, top: a.y, right: b.x, bottom: b.y, width: b.x - a.x, height: b.y - a.y }
}

const listeners = new Set()
export function onFrame (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

if (typeof document !== 'undefined') {
  frame.el = document.getElementById('frame')
  // The safe area (clear of a notch and a home bar), read off a hidden element pinned to its env() insets.
  const probe = document.createElement('div')
  probe.setAttribute('aria-hidden', 'true')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;left:env(safe-area-inset-left,0px);' +
    'top:env(safe-area-inset-top,0px);right:env(safe-area-inset-right,0px);bottom:env(safe-area-inset-bottom,0px)'
  document.body.append(probe)
  const root = document.documentElement.style
  let key = null
  const update = () => {
    const s = probe.getBoundingClientRect()
    if (!s.width || !s.height) return
    // By height: H tall above H screen px, 1:1 from H_MIN to H, H_MIN tall below. Then by width, centred, if that
    // leaves less than 4:3 of the height.
    let k = Math.max(s.height / H, Math.min(1, s.height / H_MIN))
    const h = Math.round(s.height / k)
    const minW = Math.round(h * 4 / 3)
    if (s.width / k < minW) k = s.width / minW
    const w = Math.max(minW, s.width / k)
    // On whole device pixels, so the text stays sharp.
    const px = (v) => Math.round(v * devicePixelRatio) / devicePixelRatio
    const next = { k, x: px(s.left), y: px(s.top + (s.height - h * k) / 2), w, h }
    const now = [k, next.x, next.y, w, h].join()
    if (now === key) return
    key = now
    Object.assign(frame, next)
    root.setProperty('--frame-k', String(k))
    root.setProperty('--frame-w', `${w}px`)
    root.setProperty('--frame-h', `${h}px`)
    root.setProperty('--frame-x', `${next.x}px`)
    root.setProperty('--frame-y', `${next.y}px`)
    for (const fn of listeners) fn(frame)
  }
  update()
  // A rotation is measured again a beat later: some browsers settle only then.
  const soon = () => { update(); requestAnimationFrame(update); setTimeout(update, 250) }
  window.addEventListener('resize', soon)
  window.addEventListener('orientationchange', soon)
  screen.orientation?.addEventListener?.('change', soon)
  window.visualViewport?.addEventListener('resize', soon)
  new ResizeObserver(update).observe(probe)
  // iOS Safari ignores user-scalable=no: a pinch would zoom the page out from under the frame.
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false })
}
