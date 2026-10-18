// A paired comparison stopped once it is decided (autoplay.js --paired a,b --sequential, --builds --sequential). Seeds
// are played in blocks, in seed order; after each block the paired difference in progress (b − a, in points) is read as
// z = difference / its standard error, against a group-sequential design that keeps the two-sided error at α:
//   peto     Haybittle–Peto (the default): |z| ≥ 3 before the last look, the last look's bound solved to spend α
//   pocock   Pocock: one bound at every look
//   obf      O'Brien–Fleming: C/√t, t the share of seeds played
// Each look stops for a win or a loss past its bound; from the second look to the one before the last, for futility
// (non-binding) when b's one-sided 95% upper bound on its gain is below `minGain` and b is not ahead on clears; at the
// last look a comparison neither won nor lost is level, the clears the tiebreak. Pure: no runs here.

// Φ, the standard normal distribution function (erfc by Numerical Recipes' Chebyshev fit: relative error < 1.2e-7).
function normalCdf (x) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + z / 2)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? 1 - r / 2 : r / 2
}
const pdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)

// The chance of crossing each look's two-sided bound `b` at information shares `t`, by Armitage, McPherson and Rowe's
// recursive integration (a Simpson grid carried look to look); `drift` z's mean at the last look.
// → { up, down (each look's chance of a first crossing above, below), total, stop (each look's chance of stopping) }
export function crossings (b, t, drift = 0, grid = 120) {
  const up = []
  const down = []
  let xs = null
  let f = null
  for (let k = 0; k < b.length; k++) {
    const mean = (z) => (k ? z * Math.sqrt(t[k - 1] / t[k]) + drift * (t[k] - t[k - 1]) / Math.sqrt(t[k]) : drift * Math.sqrt(t[0]))
    const sd = Math.sqrt(k ? (t[k] - t[k - 1]) / t[k] : 1)
    if (!k) {
      up.push(1 - normalCdf(b[0] - mean(0)))
      down.push(normalCdf(-b[0] - mean(0)))
    } else {
      let u = 0
      let d = 0
      for (let i = 0; i < xs.length; i++) {
        u += f[i] * (1 - normalCdf((b[k] - mean(xs[i])) / sd))
        d += f[i] * normalCdf((-b[k] - mean(xs[i])) / sd)
      }
      up.push(u)
      down.push(d)
    }
    if (k === b.length - 1) break
    // The density (times Simpson's weight) of z at look k on (−b[k], b[k]), the runs still going.
    const h = 2 * b[k] / grid
    const ys = Array.from({ length: grid + 1 }, (_, i) => -b[k] + i * h)
    const w = ys.map((_, i) => (h / 3) * (i === 0 || i === grid ? 1 : i % 2 ? 4 : 2))
    const g = k
      ? ys.map((y, j) => w[j] * xs.reduce((n, x, i) => n + f[i] * pdf((y - mean(x)) / sd) / sd, 0))
      : ys.map((y, j) => w[j] * pdf(y - mean(0)))
    xs = ys
    f = g
  }
  const total = up.reduce((a, x) => a + x, 0) + down.reduce((a, x) => a + x, 0)
  return { up, down, total, stop: up.map((u, k) => u + down[k]) }
}

// The designs by name, as a report names them.
export const DESIGN_NAMES = { peto: 'Haybittle–Peto (|z| ≥ 3 before the last look)', pocock: 'Pocock', obf: "O'Brien–Fleming" }
// Each design's bounds from a constant `c` and the information shares `t`.
const DESIGNS = {
  peto: (c, t) => t.map((_, k) => (k < t.length - 1 ? 3 : c)),
  pocock: (c, t) => t.map(() => c),
  obf: (c, t) => t.map((x) => c / Math.sqrt(x))
}
// Design `design`'s bounds at shares `t` spending two-sided `alpha` in all, its constant found by bisection.
export function boundaries (t, { design = 'peto', alpha = 0.05 } = {}) {
  const shape = DESIGNS[design]
  if (!shape) throw new Error(`unknown design "${design}": ${Object.keys(DESIGNS).join(', ')}`)
  let lo = 1
  let hi = 8
  for (let i = 0; i < 40; i++) {
    const c = (lo + hi) / 2
    if (crossings(shape(c, t), t).total > alpha) lo = c
    else hi = c
  }
  return shape(hi, t)
}

// The looks of a comparison of at most `runs` seeds in blocks of `block`, their shares and the design's bounds
// (memoized: the bisection is slow). → { looks, t, bounds, design, alpha }
const PLANS = new Map()
export function plan ({ runs = 768, block = 64, design = 'peto', alpha = 0.05 } = {}) {
  if (!(Number.isInteger(runs) && runs > 0 && Number.isInteger(block) && block > 0)) throw new Error(`--runs ${runs}, --block ${block}: whole numbers above 0`)
  const key = `${runs}|${block}|${design}|${alpha}`
  if (!PLANS.has(key)) {
    const looks = []
    for (let n = Math.min(block, runs); ; n = Math.min(n + block, runs)) {
      looks.push(n)
      if (n === runs) break
    }
    const t = looks.map((n) => n / runs)
    PLANS.set(key, Object.freeze({ looks, t, bounds: boundaries(t, { design, alpha }), design, alpha }))
  }
  return PLANS.get(key)
}

// The paired difference at a look from seed-for-seed records: progress b − a in points ± its standard error, its z;
// clears b won and lost, their difference ± its standard error. → { n, diff, se, z, won, lost, cdiff, cse }
export function look (a, b) {
  const n = Math.min(a.length, b.length)
  const mean = (d) => d.reduce((x, y) => x + y, 0) / n
  const sd = (d, m) => (n > 1 ? Math.sqrt(d.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1) / n) : 0)
  const d = Array.from({ length: n }, (_, i) => 100 * (b[i].progress - a[i].progress))
  const c = Array.from({ length: n }, (_, i) => 100 * ((b[i].result === 'victory') - (a[i].result === 'victory')))
  const diff = mean(d)
  const se = sd(d, diff)
  const cdiff = mean(c)
  return { n, diff, se, z: se ? diff / se : diff ? Math.sign(diff) * Infinity : 0, won: c.filter((x) => x > 0).length, lost: c.filter((x) => x < 0).length, cdiff, cse: sd(c, cdiff) }
}

// The least gain in progress worth playing on for, in points.
export const MIN_GAIN = 1
// The rule at look `k` of plan `p` on look `s`: `win`, `loss`, `futile`, `level` (at the last look, neither) or
// `continue`, as the head says. → { decision, bound, upper }
const FUTILE_Z = 1.645
export function decide (s, k, p, { minGain = MIN_GAIN } = {}) {
  const bound = p.bounds[k]
  const upper = s.diff + FUTILE_Z * s.se
  const last = k === p.looks.length - 1
  const decision = s.z >= bound ? 'win' : s.z <= -bound ? 'loss' : last ? 'level' : k > 0 && upper < minGain && s.won <= s.lost ? 'futile' : 'continue'
  return { decision, bound, upper }
}

// A comparison run through the rule on seed-for-seed records `a` and `b` (in seed order; the plan cut to as many as
// there are), as if played block by block. → { plan, looks: [{ k, n, ...look, decision, bound, upper }], stop }
export function sequence (a, b, { runs = Math.min(a.length, b.length), block = 64, design = 'peto', alpha = 0.05, minGain = MIN_GAIN } = {}) {
  const p = plan({ runs, block, design, alpha })
  const looks = []
  for (let k = 0; k < p.looks.length; k++) {
    const s = look(a.slice(0, p.looks[k]), b.slice(0, p.looks[k]))
    looks.push({ k, ...s, ...decide(s, k, p, { minGain }) })
    if (looks.at(-1).decision !== 'continue') break
  }
  return { plan: p, looks, stop: looks.at(-1) }
}

// A look as a line: the seeds, progress b − a ± its standard error, z against the bound, clears, the decision.
export function lookLine (x, p) {
  const sign = (v, d) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
  return `look ${x.k + 1}/${p.looks.length}: ${String(x.n).padStart(4)} seeds  progress ${sign(x.diff, 2)} ± ${x.se.toFixed(2)}  z ${sign(x.z, 2)} (bound ±${x.bound.toFixed(2)})  ` +
    `clears +${x.won} −${x.lost} (${sign(x.cdiff, 1)} ± ${x.cse.toFixed(1)})  → ${x.decision}`
}
// Where a comparison stopped (a look with decide's fields) as a line: the look, the seeds, and what was decided.
export function stopLine (x, p, { minGain = MIN_GAIN } = {}) {
  const sign = (v, d) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`
  const at = `look ${x.k + 1} of ${p.looks.length}, ${x.n} of ${p.looks.at(-1)} seeds`
  const clears = `clears +${x.won} −${x.lost} (${sign(x.cdiff, 1)} ± ${x.cse.toFixed(1)} points)`
  const tie = x.won > x.lost ? 'b ahead' : x.won < x.lost ? 'a ahead' : 'even'
  return {
    win: `decided at ${at}: a win, b better in progress (${sign(x.diff, 2)} ± ${x.se.toFixed(2)}, z ${sign(x.z, 2)} ≥ ${x.bound.toFixed(2)}); ${clears}`,
    loss: `decided at ${at}: a loss, b worse in progress (${sign(x.diff, 2)} ± ${x.se.toFixed(2)}, z ${sign(x.z, 2)} ≤ −${x.bound.toFixed(2)}); ${clears}`,
    futile: `decided at ${at}: futile, b's gain in progress at most ${sign(x.upper, 2)} (one-sided 95%), under ${sign(minGain, 1)}, and b not ahead on ${clears}`,
    level: `level after every seed: progress ${sign(x.diff, 2)} ± ${x.se.toFixed(2)} (z ${sign(x.z, 2)}, inside ±${x.bound.toFixed(2)}); the tiebreak, ${clears}: ${tie}`,
    continue: `undecided at ${at}`
  }[x.decision]
}
