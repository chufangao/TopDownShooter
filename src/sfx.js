// Sound: short effects synthesised in the browser (Web Audio), no files to load. Call sfx.play(name)
// anywhere; it never throws, and stays silent until the first user gesture (browsers require one) or
// while muted. Names: click, select, place, buy, poor, card, begin, hit, crit, kill, arise, monarchHit,
// essence, win, lose. Each name plays at most once every GAP ms, so a big battle stays a patter, not a
// roar. sfx.muted persists (prefs); setting it marks <html data-muted> for the speaker buttons' icons.
// sfx.count counts play() calls, muted or not: a click listener compares it before and after a press to
// tell whether the button played its own sound (see main.js).
import { prefs } from './dom.js'

const VOLUME = 0.22
// Minimum ms between two plays of one name; the rest are dropped.
const GAP = { hit: 55, crit: 90, kill: 70, essence: 45, arise: 160, monarchHit: 140, click: 35, select: 40, place: 50, card: 60 }
const GAP_DEFAULT = 80

let ctx = null
let out = null
let noiseBuf = null
const last = new Map()
let muted = prefs.get('muted') === '1'

const mark = () => { if (typeof document !== 'undefined') document.documentElement.dataset.muted = muted ? '1' : '0' }
mark()

// The first gesture makes (or wakes) the context; until then play() is a no-op.
function unlock () {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
      // A gentle limiter after the master gain, so stacked hits never clip.
      const comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 6
      out = ctx.createGain()
      out.gain.value = VOLUME
      out.connect(comp).connect(ctx.destination)
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
    }
    if (ctx.state === 'suspended') ctx.resume()
  } catch {}
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true })
}

// ── voices ───────────────────────────────────────────────────────────────────────────────────────

// An oscillator from f to `to` Hz over dur s, starting `at` s from now, with a quick attack and an
// exponential tail; `lp` puts a low-pass filter on it.
function tone (f, dur, { type = 'sine', to = f, gain = 0.5, at = 0, attack = 0.005, lp = 0 } = {}) {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (to !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  let node = o.connect(g)
  if (lp) {
    const fl = ctx.createBiquadFilter()
    fl.type = 'lowpass'
    fl.frequency.value = lp
    node = g.connect(fl)
  }
  node.connect(out)
  o.start(t)
  o.stop(t + dur + 0.02)
}

// A burst of white noise through a filter (`type` at `f` Hz, swept to `to`).
function noise (dur, { type = 'bandpass', f = 1500, to = f, q = 1, gain = 0.4, at = 0, attack = 0.003 } = {}) {
  const t = ctx.currentTime + at
  const src = ctx.createBufferSource()
  src.buffer = noiseBuf
  const fl = ctx.createBiquadFilter()
  fl.type = type
  fl.Q.value = q
  fl.frequency.setValueAtTime(f, t)
  if (to !== f) fl.frequency.exponentialRampToValueAtTime(to, t + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(fl).connect(g).connect(out)
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.02)
}

const jitter = (f, by = 0.06) => f * (1 + (Math.random() * 2 - 1) * by)

const SOUNDS = {
  // UI: a dry tick; a two-note pick; a soft thud onto the board; a coin; a sour buzz; a card's whoosh.
  click: () => { tone(jitter(1400, 0.03), 0.04, { type: 'triangle', to: 900, gain: 0.18 }); noise(0.02, { type: 'highpass', f: 4000, gain: 0.08 }) },
  select: () => { tone(660, 0.07, { type: 'triangle', gain: 0.2 }); tone(990, 0.1, { type: 'triangle', gain: 0.16, at: 0.05 }) },
  place: () => { tone(200, 0.12, { to: 85, gain: 0.45 }); noise(0.07, { type: 'lowpass', f: 900, gain: 0.25 }) },
  buy: () => { tone(988, 0.08, { type: 'square', gain: 0.1, lp: 3000 }); tone(1319, 0.28, { type: 'square', gain: 0.1, at: 0.07, lp: 3000 }); tone(2637, 0.2, { gain: 0.05, at: 0.07 }) },
  poor: () => { tone(150, 0.12, { type: 'sawtooth', to: 120, gain: 0.22, lp: 700 }); tone(140, 0.14, { type: 'sawtooth', to: 105, gain: 0.22, at: 0.13, lp: 700 }) },
  card: () => noise(0.16, { f: 700, to: 3400, q: 1.4, gain: 0.3, attack: 0.04 }),
  // Battle.
  begin: () => {
    tone(70, 0.9, { to: 45, gain: 0.6 })
    noise(0.6, { type: 'lowpass', f: 300, to: 1600, gain: 0.18, attack: 0.25 })
    for (const [i, f] of [220, 262, 330, 440].entries()) tone(f, 0.7 - i * 0.08, { type: 'triangle', gain: 0.1, at: 0.12 + i * 0.09, lp: 2400 })
  },
  hit: () => { noise(0.05, { f: jitter(1800, 0.2), q: 0.9, gain: 0.32 }); tone(jitter(220), 0.06, { to: 110, gain: 0.25 }) },
  crit: () => {
    noise(0.08, { type: 'highpass', f: 2200, gain: 0.35 })
    tone(880, 0.09, { type: 'square', to: 330, gain: 0.14, lp: 2600 })
    tone(1760, 0.22, { type: 'triangle', gain: 0.1, at: 0.02 })
    tone(140, 0.12, { to: 60, gain: 0.4 })
  },
  kill: () => { tone(jitter(320), 0.24, { to: 55, gain: 0.4 }); noise(0.18, { type: 'lowpass', f: 600, to: 200, gain: 0.3, at: 0.03 }) },
  arise: () => {
    tone(220, 0.55, { to: 660, gain: 0.16, attack: 0.12 })
    tone(223, 0.55, { type: 'triangle', to: 990, gain: 0.08, attack: 0.15, lp: 3000 })
    noise(0.5, { f: 600, to: 2600, q: 3, gain: 0.12, attack: 0.2 })
  },
  // The Monarch struck: a low gong under the blow, louder than any other hit.
  monarchHit: () => {
    noise(0.07, { f: 1200, q: 0.8, gain: 0.4 })
    tone(98, 0.5, { type: 'square', to: 70, gain: 0.32, lp: 500 })
    tone(196, 0.6, { gain: 0.22, at: 0.01 })
    tone(293, 0.45, { type: 'triangle', gain: 0.08, at: 0.02 })
  },
  essence: () => { const f = jitter(1568, 0.04); tone(f, 0.06, { gain: 0.1 }); tone(f * 4 / 3, 0.16, { gain: 0.09, at: 0.04 }) },
  win: () => {
    for (const [i, f] of [523, 659, 784, 1047].entries()) tone(f, i === 3 ? 0.9 : 0.25, { type: 'triangle', gain: 0.2, at: i * 0.11 })
    tone(131, 1.1, { gain: 0.25, at: 0.33 })
  },
  lose: () => {
    for (const [i, f] of [440, 349, 294, 220].entries()) tone(f, i === 3 ? 1.4 : 0.4, { type: 'sawtooth', gain: 0.12, at: i * 0.22, lp: 900 })
    tone(55, 1.8, { gain: 0.4, at: 0.66 })
  }
}

export const sfx = {
  count: 0,
  // The AudioContext's state ('running' once a gesture unlocked it), or 'locked' before any: for debugging.
  get state () { return ctx?.state ?? 'locked' },
  get muted () { return muted },
  set muted (on) {
    muted = !!on
    prefs.set('muted', muted ? '1' : '0')
    mark()
  },
  toggle () { this.muted = !muted; return muted },
  play (name) {
    sfx.count++
    try {
      if (muted || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return
      const now = performance.now()
      if (now - (last.get(name) ?? -1e9) < (GAP[name] ?? GAP_DEFAULT)) return
      last.set(name, now)
      SOUNDS[name]()
    } catch {}
  }
}
