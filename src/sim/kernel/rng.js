// Kernel primitive 7 of 7 — named RNG streams (§11.7).
//
// A mod that draws one extra random number must not shift every subsequent draw, or adding a
// cosmetic mod changes your loot. Every consumer takes a *named* stream; streams are derived by
// hashing the name into the run seed, so they are independent and reproducible, and the order in
// which streams are created never matters.
//
// Nothing here may read wall-clock time or call Math.random (invariant §18.2).

/** cyrb128 — string + numeric seed to four well-mixed uint32 words. */
function hashSeed (str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0]
}

/** Stable 32-bit hash of an arbitrary string. Used for content hashes and stream naming. */
export function hashString (str) {
  return hashSeed(str)[0]
}

/**
 * A stream is a callable `() => [0,1)` with helpers hung off it, so it drops straight into
 * `rng() < chance` and into ops that only want one number.
 */
function makeStream (name, seeds) {
  let [a, b, c, d] = seeds
  // sfc32 — small, fast, passes PractRand, and its whole state is four uint32s we can snapshot.
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    let t = (a + b) >>> 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) >>> 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) >>> 0
    t = (t + d) >>> 0
    c = (c + t) >>> 0
    return t >>> 0
  }
  const s = () => next() / 4294967296
  s.streamName = name
  /** Integer in [0, n). */
  s.int = (n) => Math.floor((next() / 4294967296) * n)
  /** Float in [lo, hi). */
  s.range = (lo, hi) => lo + (next() / 4294967296) * (hi - lo)
  s.pick = (arr) => arr[Math.floor((next() / 4294967296) * arr.length)]
  s.chance = (p) => next() / 4294967296 < p
  /** Fisher–Yates into a new array; never mutates the input. */
  s.shuffle = (arr) => {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor((next() / 4294967296) * (i + 1))
      const t = out[i]; out[i] = out[j]; out[j] = t
    }
    return out
  }
  /**
   * Weighted pick. `weights` is a parallel array of non-negative numbers.
   * Deterministic given the same arrays in the same order — callers must sort first.
   */
  s.weighted = (arr, weights) => {
    let total = 0
    for (const w of weights) total += w
    if (total <= 0) return arr[0]
    let roll = (next() / 4294967296) * total
    for (let i = 0; i < arr.length; i++) {
      roll -= weights[i]
      if (roll < 0) return arr[i]
    }
    return arr[arr.length - 1]
  }
  s.state = () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0]
  s.setState = (st) => { a = st[0] >>> 0; b = st[1] >>> 0; c = st[2] >>> 0; d = st[3] >>> 0 }
  // Warm up — sfc32's first few outputs correlate with the seed.
  for (let i = 0; i < 12; i++) next()
  return s
}

/**
 * @param {number|string} seed  run seed. Numbers and their string form are the same seed.
 * @returns {{seed, stream, has, names, snapshot, restore}}
 */
export function makeRng (seed) {
  const root = String(seed)
  const streams = new Map()

  const stream = (name) => {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('rng.stream(name) requires a non-empty name')
    }
    let s = streams.get(name)
    if (!s) {
      s = makeStream(name, hashSeed(root + '|' + name))
      streams.set(name, s)
    }
    return s
  }

  return {
    seed,
    stream,
    has: (name) => streams.has(name),
    /** Sorted, so a snapshot never depends on stream creation order. */
    names: () => [...streams.keys()].sort(),
    /** Plain JSON — goes straight into the save (§14). */
    snapshot () {
      const out = { seed, streams: {} }
      for (const name of [...streams.keys()].sort()) out.streams[name] = streams.get(name).state()
      return out
    },
    restore (snap) {
      for (const [name, state] of Object.entries(snap.streams ?? {})) stream(name).setState(state)
    }
  }
}
