// Seeded RNG (sfc32 over a cyrb128 hash). The only randomness the sim may use.

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

export function hashString (str) {
  return hashSeed(str).map((w) => w.toString(16).padStart(8, '0')).join('')
}

// createRng(seed) → () => [0,1) with helpers. stream(name) derives an independent child stream.
export function createRng (seed) {
  const root = String(seed)
  let [a, b, c, d] = hashSeed(root)
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0
    let t = (a + b) >>> 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) >>> 0
    c = (c << 21) | (c >>> 11)
    d = (d + 1) >>> 0
    t = (t + d) >>> 0
    c = (c + t) >>> 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 12; i++) next()

  const r = () => next()
  r.seed = seed
  r.int = (n) => Math.floor(next() * n)
  r.range = (lo, hi) => lo + next() * (hi - lo)
  r.chance = (p) => next() < p
  r.pick = (arr) => arr[Math.floor(next() * arr.length)]
  r.shuffle = (arr) => {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      const tmp = out[i]; out[i] = out[j]; out[j] = tmp
    }
    return out
  }
  r.weighted = (arr, weights) => {
    let total = 0
    for (const w of weights) total += w
    if (total <= 0) return arr[0]
    let roll = next() * total
    for (let i = 0; i < arr.length; i++) {
      roll -= weights[i]
      if (roll < 0) return arr[i]
    }
    return arr[arr.length - 1]
  }
  r.stream = (name) => createRng(root + '|' + name)
  return r
}
