// Sound: short effects synthesised in the browser (Web Audio), no files to load. Call sfx.play(name)
// anywhere; it never throws, and stays silent until the first user gesture (browsers require one) or
// while muted. Names: click, select, place, buy, poor, card, begin, hit, kill, arise, monarchHit,
// essence, win, lose. Each name plays at most once every GAP ms, so a big battle stays a patter, not a
// roar. sfx.muted persists (prefs); setting it marks <html data-muted> for the speaker buttons' icons.
// sfx.count counts play() calls, muted or not: a click listener compares it before and after a press to
// tell whether the button played its own sound (see main.js).
//
// They are one cast's, as the art is: cartoony, bouncy, a bit spooky. Every pitched sound takes its notes from one
// scale, D minor pentatonic (D F G A C: deg), and is played by one of three shared voices: a wooden bar struck, a
// marimba's (pluck: the interface, the purse); a squishy smack of swept noise over a falling note (thwack: the blows);
// and a wobbling voice that glides with a swelling vibrato (wobble: a theremin, a slide whistle, a trombone's wah for
// the spooky and the silly). A won battle lands on the scale's bright side (F A C), a lost one sinks home to D.
import { prefs } from './dom.js'

const VOLUME = 0.22
// Minimum ms between two plays of one name; the rest are dropped.
const GAP = { hit: 55, kill: 70, essence: 45, arise: 160, monarchHit: 140, click: 35, select: 40, place: 50, card: 60 }
const GAP_DEFAULT = 80
// Each sound's level, its voices' gains scaled by it (a bus a play), so one number sets how loud a sound stands
// against the others: matched to the sounds these replaced, within a few dB.
const LEVEL = {
  click: 0.42, select: 0.41, place: 1.06, buy: 0.46, poor: 0.25, card: 1, begin: 1.35, hit: 0.51, kill: 0.53,
  arise: 0.5, monarchHit: 1.05, essence: 0.9, win: 1.07, lose: 1.3
}

let ctx = null
let out = null
// The limiter every sound goes through, the music too (music.js: sfx.audio).
let comp = null
let bus = null
let noiseBuf = null
const last = new Map()
let muted = prefs.get('muted') === '1'

const mark = () => { if (typeof document !== 'undefined') document.documentElement.dataset.muted = muted ? '1' : '0' }
mark()
// Who hears that the context was made or woke, or that sound was muted or not (sfx.listen: the music).
const heard = new Set()
const tell = () => { for (const fn of heard) { try { fn() } catch {} } }

// The first gesture makes (or wakes) the context; until then play() is a no-op.
function unlock () {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext
      if (!AC) return
      ctx = new AC()
      // A gentle limiter after the master gain, so stacked hits never clip.
      comp = ctx.createDynamicsCompressor()
      comp.threshold.value = -14
      comp.ratio.value = 6
      out = ctx.createGain()
      out.gain.value = VOLUME
      out.connect(comp).connect(ctx.destination)
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
      const d = noiseBuf.getChannelData(0)
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
      ctx.addEventListener?.('statechange', tell)
    }
    if (ctx.state === 'suspended') ctx.resume()?.then?.(tell, () => {})
    tell()
  } catch {}
}
if (typeof window !== 'undefined') {
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true })
}

// ── the scale ────────────────────────────────────────────────────────────────────────────────────

// D minor pentatonic: the semitones of its five notes above D. deg(n): the frequency of its n-th note counting from
// D4 (0 D4, 1 F4, 2 G4, 3 A4, 4 C5, 5 D5 …; −1 C4, −5 D3, −10 D2).
const STEPS = [0, 3, 5, 7, 10]
const deg = (n) => {
  const o = Math.floor(n / 5)
  return 293.66 * 2 ** ((12 * o + STEPS[n - 5 * o]) / 12)
}
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)]

// ── the parts ────────────────────────────────────────────────────────────────────────────────────

// Every part starts from silence and decays back to it before it stops (an exponential envelope to 0.0001), so
// nothing clicks at either end. A struck part decays from its attack on; a held one (`hold`, the share of its length)
// sags only a little over that share before it lets go.
function envelope (g, t, peak, attack, dur, hold = 0) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(peak, t + attack)
  if (hold) g.gain.exponentialRampToValueAtTime(peak * 0.7, t + attack + (dur - attack) * hold)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
}

// An oscillator of `f` Hz for dur s, starting `at` s from now (held for `hold` of it, envelope): its pitch slides to
// `to` over `glide` s, a vibrato of `vib` cents at `rate` Hz swells in over its first 70%, and `lp` puts a low-pass on
// it (`wah`: the filter opens to lp × wah and closes again, a trombone's plunger).
function tone (f, dur, { type = 'sine', to = f, glide = dur, gain = 0.5, at = 0, attack = 0.005, hold = 0, lp = 0, wah = 0, q = 0.7, vib = 0, rate = 6 } = {}) {
  const t = ctx.currentTime + at
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t)
  if (to !== f) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + glide)
  if (vib) {
    const l = ctx.createOscillator()
    const depth = ctx.createGain()
    l.frequency.value = rate
    depth.gain.setValueAtTime(0, t)
    depth.gain.linearRampToValueAtTime(vib, t + dur * 0.7)
    l.connect(depth).connect(o.detune)
    l.start(t)
    l.stop(t + dur + 0.02)
  }
  envelope(g, t, gain, attack, dur, hold)
  let node = o.connect(g)
  if (lp) {
    const fl = ctx.createBiquadFilter()
    fl.type = 'lowpass'
    fl.Q.value = q
    fl.frequency.setValueAtTime(lp, t)
    if (wah) {
      fl.frequency.exponentialRampToValueAtTime(lp * wah, t + Math.min(0.1, dur * 0.35))
      fl.frequency.exponentialRampToValueAtTime(lp, t + dur)
    }
    node = g.connect(fl)
  }
  node.connect(bus)
  o.start(t)
  o.stop(t + dur + 0.02)
}

// A burst of white noise through a filter (`type` at `f` Hz, swept to `to`; `q` its resonance).
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
  envelope(g, t, gain, attack, dur)
  src.connect(fl).connect(g).connect(bus)
  src.start(t, Math.random() * 0.5)
  src.stop(t + dur + 0.02)
}

// ── the voices ───────────────────────────────────────────────────────────────────────────────────

// A wooden bar struck: note n of the scale (scooped up from `bend` below it, a bounce), its fourth partial ringing
// briefly over it as a marimba's does (and a glassy ninth where `bright` > 1), and the mallet's tick.
function pluck (n, { at = 0, gain = 0.3, dur = 0.3, bright = 1, bend = 0 } = {}) {
  const f = deg(n)
  tone(f * (1 - bend), dur, { to: f, glide: 0.018, gain, at, attack: 0.003 })
  tone(f * 4, dur * 0.3, { gain: gain * 0.22 * bright, at, attack: 0.002 })
  if (bright > 1) tone(f * 9.2, dur * 0.14, { gain: gain * 0.05 * bright, at, attack: 0.002 })
  noise(0.014, { f: Math.min(9000, f * 5), q: 1.5, gain: gain * 0.3, at, attack: 0.001 })
}

// A squishy cartoon smack: noise through a resonant low-pass swept down from `from` Hz (the wet squelch, wetter as
// `wet` rises), over note n of the scale falling an octave (the thwack's body).
function thwack (n, { at = 0, gain = 0.4, dur = 0.09, wet = 8, from = 2600 } = {}) {
  noise(dur, { type: 'lowpass', f: from, to: 240, q: wet, gain, at, attack: 0.002 })
  tone(deg(n), dur * 1.15, { to: deg(n) / 2, gain: gain * 0.8, at, attack: 0.002 })
}

// The wobbling voice: a held note from f Hz gliding to `to` over `glide` s, its vibrato swelling in, soft at both ends.
// A sine is the theremin, a triangle the slide whistle, a lowpassed sawtooth with a `wah` the trombone.
function wobble (f, to, dur, { at = 0, gain = 0.2, type = 'sine', vib = 30, rate = 6, attack = 0.03, hold = 0.65, glide = dur, lp = 0, wah = 0, q = 0.7 } = {}) {
  tone(f, dur, { type, to, glide, gain, at, attack, hold, vib, rate, lp, wah, q })
}

// ── the sounds ───────────────────────────────────────────────────────────────────────────────────

const SOUNDS = {
  // The interface: a woody tok; two bars bouncing up (a pick); a soft bump and a bar (a piece set down); a two-note
  // coin; a nasal "nuh-uh" over a dull bonk (too little essence); a card flicked off the deck.
  click: () => pluck(8, { dur: 0.07, gain: 0.3, bend: 0.06 }),
  select: () => { pluck(5, { dur: 0.12, gain: 0.3, bend: 0.12 }); pluck(7, { at: 0.055, dur: 0.17, gain: 0.26, bend: 0.1 }) },
  place: () => { thwack(-5, { dur: 0.1, wet: 2, from: 1100, gain: 0.32 }); pluck(2, { at: 0.012, dur: 0.14, gain: 0.22, bend: 0.15 }) },
  buy: () => {
    pluck(10, { dur: 0.14, gain: 0.26, bright: 2.2 })
    pluck(13, { at: 0.075, dur: 0.42, gain: 0.26, bright: 2.5 })
    noise(0.06, { type: 'highpass', f: 6500, gain: 0.05, at: 0.08, attack: 0.004 })
  },
  poor: () => {
    thwack(-7, { dur: 0.07, wet: 1, from: 700, gain: 0.3 })
    wobble(deg(2) * 0.94, deg(2), 0.11, { type: 'square', lp: 900, q: 3, gain: 0.24, vib: 0, attack: 0.012, glide: 0.04, hold: 0.5 })
    wobble(deg(0), deg(0) * 0.96, 0.17, { type: 'square', lp: 800, q: 3, gain: 0.2, vib: 0, attack: 0.012, at: 0.13, hold: 0.5 })
  },
  card: () => {
    noise(0.08, { f: 1100, to: 5200, q: 1.6, gain: 0.55, attack: 0.006 })
    noise(0.05, { f: 2000, to: 6400, q: 2, gain: 0.33, at: 0.035, attack: 0.004 })
  },
  // The battle: a spooky-cute fanfare over a drum (D F A, and a high D sliding up into a wobble).
  begin: () => {
    thwack(-10, { dur: 0.3, wet: 3, from: 520, gain: 0.5 })
    for (const [i, n] of [0, 1, 3].entries()) pluck(n, { at: 0.08 + i * 0.085, dur: 0.22, gain: 0.2 })
    wobble(deg(4), deg(5), 0.5, { type: 'triangle', at: 0.34, gain: 0.13, vib: 40, rate: 5.5, attack: 0.04, glide: 0.07 })
    pluck(-5, { at: 0.34, dur: 0.4, gain: 0.18 })
  },
  // A blow lands: a squelchy thwack on one of three low notes, so a flurry is a tune, not a drone.
  hit: () => thwack(pick([-3, -2, -1]), { dur: 0.085, wet: 9, from: 2800, gain: 0.45 }),
  // A foe falls: a slide whistle down from C6 to F4, and a puff of dust.
  kill: () => {
    wobble(deg(9), deg(1), 0.3, { type: 'triangle', gain: 0.2, vib: 25, rate: 9, attack: 0.015 })
    noise(0.18, { type: 'lowpass', f: 1500, to: 300, q: 1, gain: 0.22, at: 0.2, attack: 0.03 })
  },
  // A shadow rises: a theremin up an octave, D4 to D5, a fifth above it, and a breath swelling under them.
  arise: () => {
    wobble(deg(0), deg(5), 0.55, { gain: 0.2, vib: 45, rate: 6.5, attack: 0.1, glide: 0.45 })
    wobble(deg(3), deg(8), 0.55, { gain: 0.08, vib: 45, rate: 6.1, attack: 0.12, glide: 0.45, at: 0.02 })
    noise(0.5, { f: 500, to: 2500, q: 4, gain: 0.1, attack: 0.2 })
  },
  // The Monarch struck: a heavier smack on a low bell, D3, its partials clanging and sagging (an alarm, louder than any
  // other blow).
  monarchHit: () => {
    thwack(-6, { dur: 0.12, wet: 6, from: 1800, gain: 0.4 })
    tone(deg(-5), 0.65, { to: deg(-5) * 0.97, gain: 0.32, attack: 0.004, vib: 20, rate: 7 })
    tone(deg(0), 0.45, { to: deg(0) * 0.97, gain: 0.16, attack: 0.004 })
    tone(deg(-5) * 2.76, 0.3, { gain: 0.07, attack: 0.003 })
    tone(deg(-5) * 5.4, 0.15, { gain: 0.04, attack: 0.002 })
  },
  // An orb of essence lands: a glassy plink on one of the scale's high notes, so a stream of them is a wind chime.
  essence: () => pluck(pick([11, 12, 13, 14]), { dur: 0.12, gain: 0.26, bright: 2 }),
  // Won: a goofy "ta-da", two bars bouncing up and a wobbly F major chord (the scale's bright side).
  win: () => {
    pluck(4, { dur: 0.1, gain: 0.24, bend: 0.1 })
    pluck(6, { at: 0.08, dur: 0.12, gain: 0.24, bend: 0.1 })
    for (const n of [6, 8, 9]) wobble(deg(n) * 0.94, deg(n), 0.7, { type: 'triangle', at: 0.17, gain: 0.1, vib: 30, rate: 6, attack: 0.02, glide: 0.06 })
    pluck(-4, { at: 0.17, dur: 0.5, gain: 0.22 })
    pluck(14, { at: 0.3, dur: 0.2, gain: 0.12, bright: 2 })
  },
  // Lost: a sad trombone, wah, wah, wah, waaah, A G F down to D, each note's mute opening and closing, the last one
  // sagging under a wide vibrato over a low D.
  lose: () => {
    for (const [i, n] of [3, 2, 1].entries()) {
      wobble(deg(n), deg(n) * 0.985, 0.28, { type: 'sawtooth', at: i * 0.32, gain: 0.16, lp: 450, wah: 3.6, q: 4, vib: 12, rate: 5, attack: 0.03 })
    }
    wobble(deg(0), deg(0) * 0.93, 1.05, { type: 'sawtooth', at: 0.96, gain: 0.17, lp: 420, wah: 3.2, q: 4, vib: 55, rate: 5, attack: 0.04, glide: 1.05 })
    tone(deg(-10), 1.1, { gain: 0.22, at: 0.96, attack: 0.06 })
  }
}

export const sfx = {
  count: 0,
  // Held quiet a while (a battle resumed replays its orders unheard: engine.js); counted all the same.
  quiet: false,
  // The AudioContext's state ('running' once a gesture unlocked it), or 'locked' before any: for debugging.
  get state () { return ctx?.state ?? 'locked' },
  get muted () { return muted },
  set muted (on) {
    muted = !!on
    prefs.set('muted', muted ? '1' : '0')
    mark()
    tell()
  },
  // The context and the limiter's input, for the music to play through (null before the first gesture made them); and
  // listen(fn), fn() heard each time either changes (made, woken, or sound muted or not).
  get audio () { return ctx ? { ctx, out: comp } : null },
  listen (fn) { heard.add(fn) },
  toggle () { this.muted = !muted; return muted },
  play (name) {
    sfx.count++
    try {
      if (muted || sfx.quiet || !ctx || ctx.state !== 'running' || !SOUNDS[name]) return
      const now = performance.now()
      if (now - (last.get(name) ?? -1e9) < (GAP[name] ?? GAP_DEFAULT)) return
      last.set(name, now)
      // Its own bus at its level into the master, gone with its voices once they stop.
      bus = ctx.createGain()
      bus.gain.value = LEVEL[name] ?? 1
      bus.connect(out)
      SOUNDS[name]()
    } catch {}
  }
}
