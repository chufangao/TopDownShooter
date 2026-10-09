// The frame: the DOM interface laid out at one logical size and scaled whole to the screen, the way Slay the
// Spire or Bloons TD 6 scale theirs. One layout for every landscape screen, desktop to phone, only its scale
// changes. Its height is H logical px on a tall screen, H_MIN on a short one (a phone in landscape) and the
// screen's own height, 1:1, in between: so a phone shows the interface at ~0.73× (not 0.55×), big enough to read
// and to press, and a tall screen is never less than H tall. A wider screen gets more logical width (never side
// bars); one narrower than 4:3 is scaled by its width to 4:3 of the height instead and centred, with bars above
// and below. Layouts fit every height from H_MIN to H (@container frame (max-height: …) for the short end).
//
// Only #frame (the page: #ui, the tooltip, How to play, what flies) is scaled, by a transform; the Phaser
// canvas (#game) stays at the viewport's full native size, and board.js and engine.js keep working in viewport
// pixels. So two coordinate spaces meet here:
//   viewport px: an event's clientX/clientY, any getBoundingClientRect(), the canvas, board.rectOf/tileAt;
//   logical px: every CSS length inside #frame (a style.left, a width), and offsetWidth/offsetHeight there.
// toLocal / toLocalRect take viewport to logical (to place something in the frame by what is on screen);
// toViewport takes logical to viewport (one logical px is frame.k viewport px).
// CSS reads the frame as --frame-w and --frame-h (its logical size, in px: use them where vw and vh were),
// --frame-k (the scale) and --frame-x, --frame-y (its viewport offset); #frame is also the size container
// `frame`, for @container frame (max-height: …) where a viewport @media was.

export const H = 720
export const H_MIN = 540
export const MIN_W = 960 // 4:3 of H; a shorter frame keeps 4:3 of its own height

// k: viewport px per logical px; x, y: the frame's top left in the viewport; w, h: its logical size;
// el: #frame, where anything positioned over the page (a tooltip, an overlay, a drag's ghost) is appended.
export const frame = { k: 1, x: 0, y: 0, w: MIN_W, h: H, el: null }

export const toLocal = (x, y) => ({ x: (x - frame.x) / frame.k, y: (y - frame.y) / frame.k })
export const toViewport = (x, y) => ({ x: frame.x + x * frame.k, y: frame.y + y * frame.k })
// A rect ({ left, top, right, bottom }, a DOMRect or a board tile's) from the viewport into the frame.
export function toLocalRect (r) {
  const a = toLocal(r.left, r.top)
  const b = toLocal(r.right, r.bottom)
  return { left: a.x, top: a.y, right: b.x, bottom: b.y, width: b.x - a.x, height: b.y - a.y }
}

// fn(frame) after every change of scale or place (a resize, a rotation, the iOS toolbar coming and going).
const listeners = new Set()
export function onFrame (fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

if (typeof document !== 'undefined') {
  frame.el = document.getElementById('frame')
  // The safe area (clear of a notch and a home bar), measured off a hidden element pinned to its insets: the
  // browser resolves env() there, in the same layout viewport the fixed #frame sits in.
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
    // By height: H tall above H screen px, 1:1 from H_MIN to H, H_MIN tall below (scaled down). Then by width,
    // centred, if that leaves less than 4:3 of the height.
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
  // Every way the screen changes size or shape: a resize, a rotation (measured again a beat later, when some
  // browsers have only then settled), the iOS toolbar (the visual viewport), and anything else that resizes
  // the safe area. A rotation that only swaps the notch's side keeps the size, so the events stay too.
  const soon = () => { update(); requestAnimationFrame(update); setTimeout(update, 250) }
  window.addEventListener('resize', soon)
  window.addEventListener('orientationchange', soon)
  screen.orientation?.addEventListener?.('change', soon)
  window.visualViewport?.addEventListener('resize', soon)
  new ResizeObserver(update).observe(probe)
  // iOS Safari ignores user-scalable=no: a pinch would zoom the page out from under the frame.
  for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, (e) => e.preventDefault(), { passive: false })
}
