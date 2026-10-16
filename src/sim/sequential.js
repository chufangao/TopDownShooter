// A paired comparison stopped once it is decided (autoplay.js --paired a,b --sequential, --builds --sequential;
// redesign.md §3, §8 "Cheaper measurement"). Seeds are played in blocks, in seed order (so a sequential comparison's
// seeds are a prefix of the fixed one's), and after each block the paired difference in progress (b − a, in points: the
// primary measure, clears the tiebreak) is read as z = difference / its standard error. A group-sequential design keeps
// the overall two-sided error at α under the repeated looks: Haybittle–Peto by default (|z| ≥ 3 at every look before the
// last, the last look's bound solved so the whole design spends exactly α: 2.03 for twelve looks at 0.05), Pocock (one
// bound at every look) and O'Brien–Fleming (C/√t, t the share of seeds played) beside it. Haybittle–Peto because its
// last look is nearly the fixed test's (1.96), so a comparison played out keeps its power and its reading, and 3 is far
// enough out that the standard error's own noise at 64 seeds hardly moves it. Each look stops for a win or a loss past
// its bound; from the second look to the one before the last, for futility (non-binding: no α is spent on it) when b's
// gain in progress could not plausibly reach `minGain` (MIN_GAIN, a point: its one-sided 95% upper bound below it) and
// b is not ahead on clears either, so a change level in progress and ahead on clears, the tiebreak's keep, is never cut;
// else it plays on, to the last block, where a comparison neither won nor lost is level and the clears break the tie
// as they always did. Pure: no runs here.

// Φ, the standard normal distribution function (erfc by Numerical Recipes' Chebyshev fit: relative error < 1.2e-7).
export function normalCdf (x) {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + z / 2)
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
    t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))))
  return x >= 0 ? 1 - r / 2 : r / 2
}
const pdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)

// The chance of crossing each look's bound, `b` (two-sided, symmetric: |z| ≥ b[k]), at information shares `t` (rising
// to 1), z the paired difference's at each look, by the recursive integration of Armitage, McPherson and Rowe (Jennison
// and Turnbull, ch. 19): z's density on the region still going, on a Simpson grid, carried look to look. `drift` the
// mean of z at the last look (0: no difference). → { up: [chance of a first crossing above at each look], down, total,
// stop: [chance of stopping at each look] }
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
// The designs: each look's bound from a constant `c` and the information shares `t`. Haybittle–Peto: 3 before the last
// look, `c` at it; Pocock: `c` at every look; O'Brien–Fleming: c / √t.
export const DESIGNS = {
  peto: (c, t) => t.map((_, k) => (k < t.length - 1 ? 3 : c)),
  pocock: (c, t) => t.map(() => c),
  obf: (c, t) => t.map((x) => c / Math.sqrt(x))
}
// The bounds of design `design` at information shares `t` spending two-sided `alpha` in all (crossings under no
// difference), its constant found by bisection. → [bound at each look]
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

// The looks of a sequential comparison of at most `runs` seeds in blocks of `block`: the seeds played at each (the last
// block short where `block` does not divide `runs`), their share of `runs`, and the design's bounds (memoized: the
// bisection is a few hundred milliseconds). → { looks, t, bounds, design, alpha }
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

// The paired difference at a look from seed-for-seed progress (0–1) and clears of a and b: progress b − a in points ± one
// standard error of the paired difference, its z; clears b won (a did not clear the seed) and lost, and their difference
// in points ± its standard error. → { n, diff, se, z, won, lost, cdiff, cse }
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

// The least gain in progress worth playing on for, in points: below what 768 seeds resolve (one standard error ~1.2).
export const MIN_GAIN = 1
// The rule at look `k` of plan `p` on look `s`: `win` (z at or past the bound: b better in progress), `loss` (at or past
// its negative), `futile` (b's one-sided 95% upper bound on the gain below `minGain` points, b not ahead on clears; from
// the second look to the one before the last), `level` at the last look neither (the clears the tiebreak), else
// `continue`. → { decision, bound, upper }
export const FUTILE_Z = 1.645
export function decide (s, k, p, { minGain = MIN_GAIN } = {}) {
  const bound = p.bounds[k]
  const upper = s.diff + FUTILE_Z * s.se
  const last = k === p.looks.length - 1
  const decision = s.z >= bound ? 'win' : s.z <= -bound ? 'loss' : last ? 'level' : k > 0 && upper < minGain && s.won <= s.lost ? 'futile' : 'continue'
  return { decision, bound, upper }
}

// A comparison run through the rule on seed-for-seed records `a` and `b` (in seed order, at least the plan's `runs`
// of each, or as many as there are: the plan is cut to them), as if played block by block: every look's reading, and
// where it stopped. → { plan, looks: [{ k, n, ...look, decision, bound, upper }], stop: the last of them }
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
