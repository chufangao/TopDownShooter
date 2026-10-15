// Music (redesign.md §4.8): a loop for the title, one for each floor and one for the deep below them, synthesised in
// the browser as the effects are (Web Audio, no files). Each loop is eight bars in a dark key of its own: a slow pad,
// a bass, and a few bells (the title's a music box) over them; a floor's loop in battle adds a heartbeat drum and a
// plucked ostinato. Quiet, under the effects, through their limiter (sfx.audio).
//
// It sounds only while the music is on (prefs 'music', the note button; its volume prefs 'music:volume', How to play's
// slider) and sound is (sfx.muted, the speaker), never before the first gesture (sfx makes the context then), and
// never while the page is hidden. music.set(track, battle) asks for a loop: another loop crossfades in over the one
// playing; the same floor's in or out of battle brings its battle layer in or takes it out. The notes are scheduled
// ahead on the audio clock, a bar at a time, by a timer that runs only while music plays: nothing runs a frame.
// <html data-music> marks it on or off for the note buttons' icons. music.state says what it is doing (for debugging,
// and the browser check).
import { prefs } from './dom.js'
import { sfx } from './sfx.js'

// The level the music stands at under the effects, at full volume; the volume a first visit hears; the crossfade's
// seconds; how far ahead the timer schedules (s) and how often it wakes (ms).
const LEVEL = 0.5
const VOLUME = 0.6
const FADE = 2.5
const AHEAD = 0.6
const WAKE = 250

// ── the score ────────────────────────────────────────────────────────────────────────────────────

// The modes, as the semitones of their seven degrees above the tonic.
const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11]
}

// A loop: its tempo (`bpm`, four beats a bar), its key (`tonic`, the MIDI note of the bass's tonic) and `mode`; a bar
// each: `chords`, the degree its triad stands on (in the mode: the pad an octave over the bass, the bass its root), and
// `tune`, its notes as [beat, degree, beats], a degree counted from the tonic two octaves over the bass (7 an octave
// higher), played by `voice` (a bell, or the title's music box). `cut`: the pad's low-pass (Hz). `battle`: in battle,
// the heartbeat on each of `beats` and the ostinato's notes, eighths of the chord's root (0), third (1) and fifth (2).
const TRACKS = {
  // The title: the Monarch's music box over the pad, D minor, i VI iv v i VI VII i.
  title: {
    bpm: 52, tonic: 38, mode: 'aeolian', voice: 'box', cut: 650,
    chords: [0, 5, 3, 4, 0, 5, 6, 0],
    tune: [
      [[0, 11, 1.5], [1.5, 9, 0.5], [2, 7, 2]],
      [[0, 12, 1.5], [1.5, 11, 0.5], [2, 9, 2]],
      [[0, 10, 1], [1, 9, 1], [2, 7, 1], [3, 8, 1]],
      [[0, 8, 2], [2, 6, 1], [3, 4, 1]],
      [[0, 7, 1], [1, 9, 1], [2, 11, 2]],
      [[0, 12, 1], [1, 11, 1], [2, 9, 1.5], [3.5, 10, 0.5]],
      [[0, 10, 2], [2, 8, 1], [3, 6, 1]],
      [[0, 7, 4]]
    ]
  },
  // Floor 1, the barrows: D minor again, lower and plainer, the bells sparse.
  floor1: {
    bpm: 64, tonic: 38, mode: 'aeolian', voice: 'bell', cut: 720,
    chords: [0, 0, 5, 6, 0, 3, 4, 0],
    tune: [
      [[0, 4, 2], [2, 2, 2]],
      [[1, 0, 3]],
      [[0, 5, 1.5], [1.5, 4, 0.5], [2, 2, 2]],
      [[0, 6, 2], [2, 4, 2]],
      [[0, 7, 1], [1, 6, 1], [2, 4, 2]],
      [[0, 3, 2], [2, 5, 2]],
      [[0, 4, 3], [3, 1, 1]],
      [[0, 0, 4]]
    ],
    battle: { beats: [0, 2], arp: [0, 2, 1, 2, 0, 2, 1, 2] }
  },
  // Floor 2: A phrygian, the flat second leaning on the tonic.
  floor2: {
    bpm: 60, tonic: 33, mode: 'phrygian', voice: 'bell', cut: 680,
    chords: [0, 1, 0, 6, 0, 1, 3, 0],
    tune: [
      [[0, 7, 1], [1, 8, 1], [2, 7, 2]],
      [[0, 10, 2], [2, 9, 2]],
      [[0, 11, 3], [3, 9, 1]],
      [[0, 8, 2], [2, 6, 1], [3, 7, 1]],
      [[0, 7, 2], [2, 11, 2]],
      [[0, 12, 1], [1, 11, 1], [2, 8, 2]],
      [[0, 10, 2], [2, 12, 1], [3, 11, 1]],
      [[0, 7, 4]]
    ],
    battle: { beats: [0, 2], arp: [0, 2, 1, 2, 0, 1, 2, 1] }
  },
  // Floor 3, the Sovereign's: D phrygian, slower, the tune low.
  floor3: {
    bpm: 56, tonic: 38, mode: 'phrygian', voice: 'bell', cut: 600,
    chords: [0, 1, 0, 5, 6, 1, 3, 0],
    tune: [
      [[0, 0, 2], [2, 1, 2]],
      [[0, 5, 3], [3, 3, 1]],
      [[0, 4, 2], [2, 1, 2]],
      [[0, 3, 2], [2, 2, 2]],
      [[0, 1, 4]],
      [[0, 7, 1], [1, 8, 1], [2, 5, 2]],
      [[0, 3, 2], [2, 5, 2]],
      [[0, 0, 4]]
    ],
    battle: { beats: [0, 1.5, 2], arp: [0, 1, 2, 1, 0, 1, 2, 1] }
  },
  // The deep: D harmonic minor, its augmented third and major fifth, the slowest.
  deep: {
    bpm: 46, tonic: 38, mode: 'harmonic', voice: 'bell', cut: 560,
    chords: [0, 2, 0, 4, 5, 2, 3, 4],
    tune: [
      [[0, 7, 4]],
      [[0, 6, 2], [2, 4, 2]],
      [[1, 2, 3]],
      [[0, 6, 1], [1, 8, 1], [2, 4, 2]],
      [[0, 5, 4]],
      [[0, 4, 2], [2, 6, 2]],
      [[0, 3, 2], [2, 5, 2]],
      [[0, 6, 3], [3, 8, 1]]
    ],
    battle: { beats: [0], arp: [0, null, 2, null, 1, null, 2, null] }
  }
}
// The loop of a floor: floors past the run's last are the deep's (`deep`), the run's own its own, the last's beyond
// the three written.
export const trackOf = (floor, deep = false) => (deep ? 'deep' : `floor${Math.max(1, Math.min(3, floor))}`)

// The semitones of the mode's degree `step` above the tonic (degrees past the seventh in the octaves above).
const semi = (mode, step) => 12 * Math.floor(step / 7) + MODES[mode][((step % 7) + 7) % 7]
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

// The notes of bar `bar` of loop `def`: { t (beats into the bar), midi, beats, voice, layer ('base' or 'battle') }.
export function notesOf (def, bar) {
  const c = def.chords[bar]
  const triad = [c, c + 2, c + 4].map((step) => def.tonic + 12 + semi(def.mode, step))
  const root = semi(def.mode, c)
  const out = triad.map((midi) => ({ t: 0, midi, beats: 4, voice: 'pad', layer: 'base' }))
  out.push({ t: 0, midi: def.tonic + root - (root > 7 ? 12 : 0), beats: 4, voice: 'bass', layer: 'base' })
  for (const [t, d, beats] of def.tune[bar]) out.push({ t, midi: def.tonic + 24 + semi(def.mode, d), beats, voice: def.voice, layer: 'base' })
  if (def.battle) {
    for (const t of def.battle.beats) out.push({ t, midi: 0, beats: 1, voice: 'drum', layer: 'battle' })
    def.battle.arp.forEach((k, i) => { if (k !== null) out.push({ t: i / 2, midi: triad[k], beats: 0.5, voice: 'pluck', layer: 'battle' }) })
  }
  return out
}

// ── the voices ───────────────────────────────────────────────────────────────────────────────────

// Each voice plays one note at `t` (the context's seconds) for `dur` seconds into `dest`, `send` its echo's input where
// it rings. Every one starts from silence and ends in it.
function voice (ctx, noise, kind, f, t, dur, dest, send) {
  const gain = (peak, attack, hold, release, to = dest) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + attack)
    g.gain.setValueAtTime(peak, t + attack + hold)
    g.gain.linearRampToValueAtTime(0, t + attack + hold + release)
    g.connect(to)
    return g
  }
  const ring = (peak, decay, to = dest) => {
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay)
    g.connect(to)
    return g
  }
  const osc = (type, freq, into, end, detune = 0) => {
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(freq, t)
    o.detune.value = detune
    o.connect(into)
    o.start(t)
    o.stop(end + 0.05)
    return o
  }
  if (kind === 'pad') {
    // Two triangles a few cents apart, under a low-pass, swelling in over a third of the bar and out past its end.
    const g = gain(0.032, dur * 0.35, dur * 0.4, dur * 0.25 + 1.4)
    const end = t + dur * 1 + 1.4
    osc('triangle', f, g, end, -6)
    osc('triangle', f, g, end, 6)
  } else if (kind === 'bass') {
    const g = gain(0.1, 0.08, dur * 0.6, dur * 0.4 + 0.3)
    const end = t + dur + 0.4
    osc('sine', f, g, end)
    osc('triangle', f * 2, gain(0.018, 0.08, dur * 0.6, dur * 0.4 + 0.3), end)
  } else if (kind === 'bell' || kind === 'box') {
    // A struck bell's partials (or a music box's tine: brighter, shorter), the body ringing longest, into the echo too.
    const decay = Math.max(dur, kind === 'box' ? 1.4 : 2.2)
    const body = ring(kind === 'box' ? 0.07 : 0.06, decay)
    body.connect(send)
    osc('sine', f, body, t + decay)
    const [p, k] = kind === 'box' ? [3.99, 0.22] : [2.76, 0.32]
    osc('sine', f * p, ring(0.06 * k, decay * 0.35), t + decay * 0.35)
    if (kind === 'bell') osc('sine', f * 5.4, ring(0.006, decay * 0.15), t + decay * 0.15)
  } else if (kind === 'drum') {
    // The heartbeat: a low thump falling in pitch, and a soft knock of filtered noise on it.
    const g = ring(0.22, 0.32)
    const o = osc('sine', 88, g, t + 0.32)
    o.frequency.exponentialRampToValueAtTime(42, t + 0.14)
    const src = ctx.createBufferSource()
    src.buffer = noise
    const fl = ctx.createBiquadFilter()
    fl.type = 'lowpass'
    fl.frequency.value = 380
    src.connect(fl).connect(ring(0.05, 0.06))
    src.start(t, Math.random() * 0.5)
    src.stop(t + 0.08)
  } else if (kind === 'pluck') {
    // The ostinato: a soft plucked triangle under a low-pass, into the echo.
    const fl = ctx.createBiquadFilter()
    fl.type = 'lowpass'
    fl.frequency.value = 1300
    const g = ring(0.035, 0.38, fl)
    fl.connect(dest)
    fl.connect(send)
    osc('triangle', f, g, t + 0.38)
  }
}

// ── the player ───────────────────────────────────────────────────────────────────────────────────

let on = prefs.get('music') !== '0'
let volume = (() => { const v = Number(prefs.get('music:volume')); return prefs.get('music:volume') !== null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : VOLUME })()
// What is asked for (set), what plays (`now`: the loop's nodes and where it stands), the context's own parts, the timer.
const want = { id: null, battle: false }
let now = null
let graph = null
let timer = null
const stats = { bars: 0, notes: 0, ticks: 0, fades: 0 }

const mark = () => { if (typeof document !== 'undefined') document.documentElement.dataset.music = on ? '1' : '0' }
mark()

// Whether music should sound now.
const audible = () => on && volume > 0 && !sfx.muted && !!want.id && typeof document !== 'undefined' && !document.hidden && sfx.audio?.ctx.state === 'running'

// The context's own parts, made once on it: the music's master (its level × the volume) into the effects' limiter, and
// a second of noise for the drum.
function parts (ctx, out) {
  if (graph?.ctx === ctx) return graph
  graph = partsOf(ctx, out, 0)
  return graph
}
function partsOf (ctx, out, level) {
  const master = ctx.createGain()
  master.gain.value = level
  master.connect(out)
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate)
  const d = noise.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return { ctx, master, noise }
}

// A loop begun at `t` on bus `into` (its own gain, for the crossfade): its battle layer's gain, its echo (a dotted
// eighth's delay, fed back through a low-pass), and where it stands.
function begin (ctx, id, t, into, inBattle = want.battle, fade = FADE) {
  const def = TRACKS[id]
  const bus = ctx.createGain()
  bus.gain.setValueAtTime(0, t)
  bus.gain.linearRampToValueAtTime(1, t + fade)
  bus.connect(into)
  const battle = ctx.createGain()
  battle.gain.value = inBattle && def.battle ? 1 : 0
  battle.connect(bus)
  const send = ctx.createGain()
  send.gain.value = 0.35
  const delay = ctx.createDelay(2)
  delay.delayTime.value = 60 / def.bpm * 0.75
  const back = ctx.createGain()
  back.gain.value = 0.3
  const damp = ctx.createBiquadFilter()
  damp.type = 'lowpass'
  damp.frequency.value = 2400
  send.connect(delay).connect(damp).connect(back).connect(delay)
  damp.connect(bus)
  return { id, def, bus, battle, send, nodes: [bus, battle, send, delay, back, damp], next: t, bar: 0, at: t, last: 0, armed: battle.gain.value > 0 }
}

// Bar `bar` of the loop playing, from `t0` on: its base layer, and its battle layer while in battle. `from`: only the
// notes from then on, of `layer` alone (the battle's, come in mid-bar).
function schedule (p, bar, t0, { layer = null, from = 0 } = {}, g = graph) {
  const { ctx, noise } = g
  const beat = 60 / p.def.bpm
  for (const n of notesOf(p.def, bar)) {
    if (layer ? n.layer !== layer : n.layer === 'battle' && !p.armed) continue
    const t = t0 + n.t * beat
    if (t < from) continue
    voice(ctx, noise, n.voice, hz(n.midi), t, n.beats * beat, n.layer === 'battle' ? p.battle : p.bus, p.send)
    stats.notes++
  }
  stats.bars++
}

// The timer: every bar whose start falls within AHEAD of the clock scheduled whole.
function tick () {
  stats.ticks++
  if (!now || !graph) return
  const ctx = graph.ctx
  const len = 240 / now.def.bpm
  // A clock that ran on while the timer slept: pick the loop up at the next moment.
  if (now.next < ctx.currentTime - 0.05) now.next = ctx.currentTime + 0.05
  while (now.next < ctx.currentTime + AHEAD) {
    schedule(now, now.bar, now.next)
    now.at = now.next
    now.last = now.bar
    now.next += len
    now.bar = (now.bar + 1) % now.def.chords.length
  }
}

// A loop let go: faded out from `t` over `fade` seconds, its nodes freed after.
function drop (p, t, fade) {
  if (!p) return
  p.bus.gain.cancelScheduledValues(t)
  p.bus.gain.setValueAtTime(p.bus.gain.value, t)
  p.bus.gain.linearRampToValueAtTime(0, t + fade)
  stats.fades++
  setTimeout(() => { for (const n of p.nodes) { try { n.disconnect() } catch {} } }, (fade + 0.2) * 1000)
}

// Brings what plays to what is asked for: silence, the loop asked for (crossfaded in), its battle layer in or out.
function sync () {
  const a = sfx.audio
  if (!audible()) {
    if (timer) { clearInterval(timer); timer = null }
    if (graph && now) {
      const t = graph.ctx.currentTime
      graph.master.gain.setTargetAtTime(0, t, 0.12)
      drop(now, t, 0.5)
      now = null
    }
    return
  }
  const { ctx, master } = parts(a.ctx, a.out)
  const t = ctx.currentTime
  master.gain.setTargetAtTime(LEVEL * volume, t, 0.15)
  if (now?.id !== want.id) {
    drop(now, t, FADE)
    now = begin(ctx, want.id, t + 0.05, master)
  } else if (now.armed !== (want.battle && !!now.def.battle)) {
    now.armed = !now.armed
    now.battle.gain.setTargetAtTime(now.armed ? 1 : 0, t, now.armed ? 0.5 : 0.4)
    // In battle mid-bar: the rest of the bar's battle notes, so the drum comes in at once.
    if (now.armed && now.at <= t && t < now.next) schedule(now, now.last, now.at, { layer: 'battle', from: t + 0.05 })
  }
  if (!timer) timer = setInterval(tick, WAKE)
  tick()
}

// Loop `id` scheduled whole on `ctx`, `bars` bars from its first (its battle layer with `battle`), at the level the
// player hears at `volume`, through a limiter as the effects' (sfx.js): for an OfflineAudioContext to render, and the
// browser check to measure. → the number of notes scheduled.
export function renderLoop (ctx, id, { bars = 8, battle = false, volume: v = volume } = {}) {
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -14
  comp.ratio.value = 6
  comp.connect(ctx.destination)
  const g = partsOf(ctx, comp, LEVEL * v)
  const p = begin(ctx, id, 0, g.master, battle, 0.01)
  const before = stats.notes
  for (let i = 0; i < bars; i++) schedule(p, i % p.def.chords.length, i * 240 / p.def.bpm, {}, g)
  return stats.notes - before
}

sfx.listen(sync)
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', sync)

export const music = {
  // On or off (prefs 'music'; on unless turned off): heard only while sound is on too.
  get on () { return on },
  set on (v) {
    on = !!v
    prefs.set('music', on ? '1' : '0')
    mark()
    sync()
  },
  toggle () { this.on = !on; return on },
  // 0 to 1 (prefs 'music:volume').
  get volume () { return volume },
  set volume (v) {
    volume = Math.max(0, Math.min(1, Number(v) || 0))
    prefs.set('music:volume', String(volume))
    sync()
  },
  // The loop asked for: a track of TRACKS ('title', 'floor1'…, 'deep'; trackOf) and whether in battle; null for none.
  set (id, battle = false) {
    if (id !== null && !TRACKS[id]) return
    if (want.id === id && want.battle === battle) return
    Object.assign(want, { id, battle })
    sync()
  },
  // What it is doing: asked for, playing (and in battle), whether the timer runs, what it has scheduled.
  get state () {
    return {
      on, volume, want: { ...want }, playing: now?.id ?? null, battle: !!now?.armed, ticking: timer !== null,
      context: sfx.audio?.ctx.state ?? 'locked', level: graph ? graph.master.gain.value : 0, ...stats
    }
  },
  tracks: Object.keys(TRACKS)
}
