// Training V, the learned expert's value of a board (redesign.md §2.21, §5 Step 8): offline, like the combo book and
// risk.js. Three stages, each kept on disk in `--data` so a stage stopped part way goes on from where it was:
//
//   play       expert runs (autoplay.js policy, the stream autoplay's; seeds `<seed>-1`…`<seed>-<runs>`) in worker
//              threads; each run kept as its action log (run.js replay plays it back exactly): runs.bin
//   positions  each run's log replayed (no policy called: ~40× faster than playing), positions sampled from every
//              battle: each turn's start, the board each act leaves, the board as End Turn is given; each encoded
//              (value.js encode) and labelled by what followed (the battle's result; the Monarch's HP share and your
//              pieces' lost over the next two turns); won battles' positions thinned (and weighted back up), lost and
//              near-lost battles' kept whole and listed as disasters (seed and log index of each turn's start, to be
//              replayed with exploration: disasters.json): positions.bin
//   fit        V fitted on the runs whose seed number is not ≡ 0 (mod 5) — early stopping and the recalibration on
//              those ≡ 1, the network on the rest — and read on the held-out runs (≡ 0): log-loss, AUC and calibration
//              of P(won), MSE of the HP outputs; written to value.json
//
//   npm run train -- [--runs 1000] [--seed value] [--workers 4] [--data dir] [--out src/sim/value.json]
//                    [--play-only | --no-play | --no-fit] [--lambda 1] [--epochs 40] [--patience 6] [--hidden 64]
//                    [--batch 256] [--lr 1e-3] [--l2 1e-5] [--disasters 0.33] [--net-seed 1]
//
// `--data` defaults to the OS's temp directory (retinue-value-<seed>); it holds runs.bin (the logs), positions.bin (the
// encoded positions: made again when FEATURES, KEEP, NEAR or λ change) and disasters.json. `--no-play` fits on the
// runs already played. `--lambda` below 1 takes TD(λ) targets for P(won) from the weights in use (value.json) across
// each battle's turns (round 1 on: redesign.md §2.21 self-play), 1 the battle's result alone (round 0). Delete --data
// (or take another --seed) once the game or the expert has changed. Disasters are replayed by replayTo (a run's log to a
// turn's start) once the player's `explore` option can play them on with exploration.
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

// ── stage 1: play ────────────────────────────────────────────────────────────────────────────────

// One expert run, kept as { seed, result, floor, log }. Dynamic imports: a worker's alone.
async function playRun (seed) {
  const { policy } = await import('./autoplay.js')
  const { createRun, apply } = await import('./run.js')
  const { createRng } = await import('./rng.js')
  const run = createRun({ seed })
  const rng = createRng(run.state.seed).stream('autoplay')
  for (let guard = 0; run.state.phase !== 'over'; guard++) {
    if (guard > 1e6) throw new Error(`${seed}: stuck`)
    apply(run, policy(run, rng, 'expert'))
  }
  return { seed, result: run.state.result, floor: run.state.floor, log: run.state.log }
}

// A file of records, each a 4-byte length then a gzipped JSON value, appended one at a time (a stage stopped part way
// keeps what it made).
export const pack = (value) => {
  const body = zlib.gzipSync(JSON.stringify(value))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(body.length)
  return Buffer.concat([len, body])
}
export function unpackAll (file) {
  if (!fs.existsSync(file)) return []
  const buf = fs.readFileSync(file)
  const out = []
  for (let at = 0; at + 4 <= buf.length;) {
    const len = buf.readUInt32LE(at)
    if (at + 4 + len > buf.length) break
    out.push(JSON.parse(zlib.gunzipSync(buf.subarray(at + 4, at + 4 + len))))
    at += 4 + len
  }
  return out
}

// A seed's number (`value-17` → 17): what the split by run reads.
export const seedNo = (seed) => Number(String(seed).match(/(\d+)$/)?.[1] ?? 0)

// Runs `job(item)` in worker threads of this module (`kind` the worker's job), `workers` at a time, handing each
// result to `done` as it ends (in the order they end).
async function pool (kind, items, workers, done, extra = {}) {
  const { Worker } = await import('node:worker_threads')
  const queue = items.slice()
  let n = 0
  const t0 = Date.now()
  const every = Math.max(1, Math.round(items.length / 20))
  const worker = async () => {
    const w = new Worker(new URL(import.meta.url), { workerData: { kind, ...extra } })
    try {
      while (queue.length) {
        const item = queue.shift()
        done(await new Promise((resolve, reject) => {
          const off = () => { w.off('message', ok); w.off('error', fail) }
          const ok = (msg) => { off(); resolve(msg) }
          const fail = (err) => { off(); reject(err) }
          w.on('message', ok)
          w.on('error', fail)
          w.postMessage(item)
        }))
        if (++n % every === 0 || n === items.length) console.log(`  ${kind}: ${n}/${items.length}, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
      }
    } finally {
      await w.terminate()
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker))
}

// ── stage 2: positions ───────────────────────────────────────────────────────────────────────────

// How positions are thinned in a battle neither lost nor near-lost (a turn's start and End Turn's board kept with
// chance `edge`, the board an act leaves with `mid`; each kept one weighed 1 / its chance, so the data stand for every
// position), and what makes a won battle near-lost: the Monarch at or under `share` of its max at a turn's start or
// the end, or `drop` of its max lost in the battle.
export const KEEP = { edge: 0.4, mid: 0.15 }
export const NEAR = { share: 0.35, drop: 0.4 }
// A position's meta, in order: its run's seed number, its battle's number in the run, the turn, its kind (0 a turn's
// start, 1 the board an act left, 2 the board as End Turn is given), its battle's group (0, 1 near-lost, 2 lost), the
// floor.
export const META = ['run', 'battle', 'turn', 'kind', 'group', 'floor']

// Your pieces' HP and max HP summed (the units that take orders: not the Monarch, not shadows and summons).
function piecesHp (b) {
  let hp = 0
  let max = 0
  for (const u of b.units) {
    if (u.side !== 'party' || u.hp <= 0 || u.shadow || u === b.monarch) continue
    hp += u.hp
    max += u.maxHp
  }
  return { hp, max }
}

// A deterministic chance in [0, 1) for a position (its run, battle, place in the battle).
const chance = (run, battle, seq) => mulberryOf(((run * 73856093) ^ (battle * 19349663) ^ (seq * 83492791)) >>> 0)()
let mulberryOf = null

// The λ-return over a battle's turns (γ 1, no reward but the end): y[T] = z for the last turn T, y[t] = (1 − λ)·v[t + 1]
// + λ·y[t + 1] before it (v[t]: V's P(won) at turn t's start). λ 1 gives z throughout.
export function lambdaReturns (v, z, lambda) {
  const y = new Float64Array(v.length)
  for (let t = v.length - 1; t >= 0; t--) y[t] = t === v.length - 1 ? z : (1 - lambda) * v[t + 1] + lambda * y[t + 1]
  return y
}

// One run's positions, its log replayed (run.js apply; no policy called): { seed, n, X (n × FEATURES), Y (n × 3:
// P(won)'s target, the Monarch's and your pieces' HP shares lost over the next two turns), Z (the battle won, 0/1),
// meta (n × META), wt (n), disasters }. `lambda` < 1: P(won)'s target the λ-return from V's weights in use.
export async function positionsOf (rec, { lambda = 1 } = {}) {
  const { createRun, apply } = await import('./run.js')
  const V = await import('./value.js')
  mulberryOf ??= V.mulberry
  if (lambda < 1 && !V.loaded()) throw new Error('TD(λ) targets need trained weights in value.json')
  const D = V.FEATURES.length
  const runNo = seedNo(rec.seed)
  const run = createRun({ seed: rec.seed })
  const rows = []
  const disasters = []
  let cur = null
  let battles = -1
  const take = (b, kind) => {
    const own = piecesHp(b)
    cur.samples.push({ x: V.encode(b), turn: b.turn, kind, m: Math.max(0, b.monarch.hp), mMax: b.monarch.maxHp, own: own.hp, ownMax: own.max })
  }
  const close = () => {
    const b = cur.b
    const z = b.winner === 'party' ? 1 : 0
    const mMax = b.monarch.maxHp
    const end = { m: Math.max(0, b.monarch.hp), own: piecesHp(b).hp }
    const turns = [...cur.turns.keys()].sort((p, q) => p - q)
    const shares = [...turns.map((t) => cur.turns.get(t).m), end.m].map((m) => m / mMax)
    const least = Math.min(...shares)
    const group = !z ? 2 : least <= NEAR.share || shares[0] - least >= NEAR.drop ? 1 : 0
    const y = lambdaReturns(turns.map((t) => cur.turns.get(t).v ?? z), z, lambda)
    const yOf = new Map(turns.map((t, i) => [t, y[i]]))
    cur.samples.forEach((p, seq) => {
      let wt = 1
      if (group === 0) {
        const keep = p.kind === 1 ? KEEP.mid : KEEP.edge
        if (chance(runNo, cur.no, seq) >= keep) return
        wt = 1 / keep
      }
      const then = cur.turns.get(p.turn + 2) ?? end
      rows.push({ x: p.x, y: [yOf.get(p.turn) ?? z, (p.m - then.m) / p.mMax, p.ownMax > 0 ? (p.own - then.own) / p.ownMax : 0], z, wt, meta: [runNo, cur.no, p.turn, p.kind, group, cur.floor] })
    })
    if (group > 0) {
      disasters.push({ seed: rec.seed, battle: cur.no, floor: cur.floor, lost: !z, least: +least.toFixed(4), turns: turns.map((t) => ({ turn: t, at: cur.turns.get(t).at })) })
    }
    cur = null
  }
  for (let i = 0; i < rec.log.length; i++) {
    const a = rec.log[i]
    const inBattle = run.state.phase === 'battle'
    const b = run.battle
    if (inBattle) {
      if (!cur || cur.b !== b) cur = { b, no: ++battles, floor: run.state.floor, samples: [], turns: new Map(), last: -1 }
      if (!b.over && b.stage === 'party' && b.turn !== cur.last) {
        cur.last = b.turn
        cur.turns.set(b.turn, { m: Math.max(0, b.monarch.hp), own: piecesHp(b).hp, at: i, v: lambda < 1 ? V.predict(b).won : null })
        take(b, 0)
      }
      if (a.type === 'end' && !b.over) take(b, 2)
    }
    apply(run, a)
    if (inBattle && !b.over && a.type === 'act') take(b, 1)
    if (inBattle && b.over && cur) close()
  }
  const n = rows.length
  const out = { seed: rec.seed, n, X: new Float32Array(n * D), Y: new Float32Array(n * 3), Z: new Uint8Array(n), meta: new Int32Array(n * META.length), wt: new Float32Array(n), disasters }
  rows.forEach((r, i) => {
    out.X.set(r.x, i * D)
    out.Y.set(r.y, i * 3)
    out.Z[i] = r.z
    out.meta.set(r.meta, i * META.length)
    out.wt[i] = r.wt
  })
  return out
}

// The positions file (positions.bin): a line naming what made it (the features, KEEP, NEAR, λ and the weights TD read),
// then a record a run: a 4-byte length, a JSON head ({ seed, n, disasters }), then X, Y, Z, meta and wt's bytes.
const PARTS = [['X', Float32Array], ['Y', Float32Array], ['Z', Uint8Array], ['meta', Int32Array], ['wt', Float32Array]]
function packPositions (r) {
  const head = Buffer.from(JSON.stringify({ seed: r.seed, n: r.n, disasters: r.disasters }))
  const len = Buffer.alloc(4)
  len.writeUInt32LE(head.length)
  return Buffer.concat([len, head, ...PARTS.map(([k]) => Buffer.from(r[k].buffer, r[k].byteOffset, r[k].byteLength))])
}
function readPositions (file, header, D) {
  if (!fs.existsSync(file)) return []
  const buf = fs.readFileSync(file)
  const nl = buf.indexOf(10)
  if (nl < 0 || buf.subarray(0, nl).toString() !== header) return null
  const out = []
  for (let at = nl + 1; at + 4 <= buf.length;) {
    const len = buf.readUInt32LE(at)
    const head = JSON.parse(buf.subarray(at + 4, at + 4 + len).toString())
    let o = at + 4 + len
    const r = { ...head }
    const sizes = { X: head.n * D, Y: head.n * 3, Z: head.n, meta: head.n * META.length, wt: head.n }
    for (const [k, T] of PARTS) {
      const bytes = sizes[k] * T.BYTES_PER_ELEMENT
      if (o + bytes > buf.length) return out
      r[k] = new T(buf.buffer.slice(buf.byteOffset + o, buf.byteOffset + o + bytes))
      o += bytes
    }
    out.push(r)
    at = o
  }
  return out
}

// Many runs' positions as flat arrays, the runs in seed order.
function gather (list, D) {
  const runs = list.slice().sort((a, b) => seedNo(a.seed) - seedNo(b.seed))
  const n = runs.reduce((k, r) => k + r.n, 0)
  const data = { n, D, X: new Float32Array(n * D), Y: new Float32Array(n * 3), Z: new Uint8Array(n), meta: new Int32Array(n * META.length), wt: new Float32Array(n), runs: runs.length, disasters: runs.flatMap((r) => r.disasters) }
  let a = 0
  for (const r of runs) {
    data.X.set(r.X, a * D)
    data.Y.set(r.Y, a * 3)
    data.Z.set(r.Z, a)
    data.meta.set(r.meta, a * META.length)
    data.wt.set(r.wt, a)
    a += r.n
  }
  return data
}

// A disaster's board again: run `rec` (a runs.bin record) replayed to log index `at` (a turn's start: disasters.json),
// its battle (run.battle) standing at that turn as the expert met it. For the replays with exploration (§2.21).
export async function replayTo (rec, at) {
  const { createRun, apply } = await import('./run.js')
  const run = createRun({ seed: rec.seed })
  for (let i = 0; i < at; i++) apply(run, rec.log[i])
  return run
}

// ── stage 3: fit ─────────────────────────────────────────────────────────────────────────────────

const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const clampP = (p) => Math.min(1 - 1e-7, Math.max(1e-7, p))

// The weighted area under the ROC curve of scores p for labels t (weights w; ties count half).
export function weightedAuc (p, t, w) {
  const order = Array.from(p.keys()).sort((a, b) => p[a] - p[b])
  let neg = 0
  let pos = 0
  let sum = 0
  for (let i = 0; i < order.length;) {
    let j = i
    let tp = 0
    let tn = 0
    while (j < order.length && p[order[j]] === p[order[i]]) {
      if (t[order[j]]) tp += w[order[j]]
      else tn += w[order[j]]
      j++
    }
    sum += tp * (neg + tn / 2)
    pos += tp
    neg += tn
    i = j
  }
  return pos && neg ? sum / (pos * neg) : NaN
}

// The standardised rows `idx` of the data into a Float64Array (k × D), their targets into Y (k × 3).
function batchOf (data, idx, mean, isd, Xb, Yb) {
  const D = data.D
  for (let r = 0; r < idx.length; r++) {
    const o = idx[r] * D
    const ob = r * D
    for (let j = 0; j < D; j++) Xb[ob + j] = (data.X[o + j] - mean[j]) * isd[j]
    for (let k = 0; k < 3; k++) Yb[r * 3 + k] = data.Y[idx[r] * 3 + k]
  }
}

// The net's raw outputs on rows `rows` (n × 3), in chunks.
function outputsOn (V, net, data, rows, mean, isd) {
  const out = new Float64Array(rows.length * 3)
  const CH = 1024
  const Xb = new Float64Array(CH * data.D)
  const Yb = new Float64Array(CH * 3)
  const acts = []
  for (let a = 0; a < rows.length; a += CH) {
    const idx = rows.slice(a, a + CH)
    batchOf(data, idx, mean, isd, Xb, Yb)
    const A = V.forwardAll(net, Xb, idx.length, acts)
    out.set(A[A.length - 1].subarray(0, idx.length * 3), a * 3)
  }
  return out
}

// Weighted means of the targets and the losses of outputs `o` on rows `rows`: P(won)'s log-loss (and the base rate's),
// AUC, the HP outputs' MSE (and their variance).
function reading (data, rows, o, { calibration = false } = {}) {
  let W = 0
  const mean = [0, 0, 0]
  for (const r of rows) {
    const w = data.wt[r]
    W += w
    for (let k = 0; k < 3; k++) mean[k] += w * data.Y[r * 3 + k]
  }
  for (let k = 0; k < 3; k++) mean[k] /= W
  let ll = 0
  let base = 0
  const mse = [0, 0, 0]
  const vari = [0, 0, 0]
  const p = new Float64Array(rows.length)
  const t = new Uint8Array(rows.length)
  const w = new Float64Array(rows.length)
  rows.forEach((r, i) => {
    const wt = data.wt[r]
    const y = data.Y[r * 3]
    const q = clampP(sigmoid(o[i * 3]))
    ll -= wt * (y * Math.log(q) + (1 - y) * Math.log(1 - q))
    const b = clampP(mean[0])
    base -= wt * (y * Math.log(b) + (1 - y) * Math.log(1 - b))
    for (let k = 1; k < 3; k++) {
      mse[k] += wt * (o[i * 3 + k] - data.Y[r * 3 + k]) ** 2
      vari[k] += wt * (data.Y[r * 3 + k] - mean[k]) ** 2
    }
    p[i] = q
    t[i] = data.Z[r]
    w[i] = wt
  })
  const out = {
    n: rows.length,
    won: +mean[0].toFixed(5),
    monarch: +mean[1].toFixed(5),
    own: +mean[2].toFixed(5),
    logLoss: +(ll / W).toFixed(5),
    baseLogLoss: +(base / W).toFixed(5),
    auc: +weightedAuc(p, t, w).toFixed(4),
    monarchMse: +(mse[1] / W).toFixed(6),
    monarchVar: +(vari[1] / W).toFixed(6),
    ownMse: +(mse[2] / W).toFixed(6),
    ownVar: +(vari[2] / W).toFixed(6)
  }
  out.monarchR2 = +(1 - out.monarchMse / out.monarchVar).toFixed(4)
  out.ownR2 = +(1 - out.ownMse / out.ownVar).toFixed(4)
  // The objective early stopping reads: each loss over its base's.
  out.score = out.logLoss / out.baseLogLoss + out.monarchMse / out.monarchVar + out.ownMse / out.ownVar
  if (calibration) {
    // By the predicted chance the battle is lost: [mean predicted, observed, weighted rows].
    const BINS = [0, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.4, 0.7, 1.0001]
    out.calibration = []
    for (let k = 0; k + 1 < BINS.length; k++) {
      let ww = 0
      let pp = 0
      let lost = 0
      p.forEach((q, i) => {
        const l = 1 - q
        if (l < BINS[k] || l >= BINS[k + 1]) return
        ww += w[i]
        pp += w[i] * l
        lost += w[i] * (1 - t[i])
      })
      if (ww) out.calibration.push([+(pp / ww).toFixed(4), +(lost / ww).toFixed(4), Math.round(ww)])
    }
  }
  return out
}

// Recalibration on rows `rows` (weighted): P(won)'s logit a·z + c fitted by log-loss (Platt, Newton's method), each HP
// output a·o + c by least squares; folded into the last layer. → the [a, c] of each output.
function recalibrate (V, net, data, rows, mean, isd) {
  const o = outputsOn(V, net, data, rows, mean, isd)
  const fit = []
  // Platt.
  let a = 1
  let c = 0
  for (let it = 0; it < 50; it++) {
    let g0 = 0; let g1 = 0; let h00 = 0; let h01 = 0; let h11 = 0
    rows.forEach((r, i) => {
      const w = data.wt[r]
      const z = o[i * 3]
      const p = sigmoid(a * z + c)
      const e = p - data.Y[r * 3]
      const v = w * Math.max(1e-12, p * (1 - p))
      g0 += w * e * z; g1 += w * e
      h00 += v * z * z; h01 += v * z; h11 += v
    })
    h00 += 1e-9; h11 += 1e-9
    const det = h00 * h11 - h01 * h01
    const da = (h11 * g0 - h01 * g1) / det
    const dc = (h00 * g1 - h01 * g0) / det
    a -= da
    c -= dc
    if (Math.abs(da) + Math.abs(dc) < 1e-10) break
  }
  fit.push([a, c])
  for (let k = 1; k < 3; k++) {
    let sw = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0
    rows.forEach((r, i) => {
      const w = data.wt[r]
      const x = o[i * 3 + k]
      const y = data.Y[r * 3 + k]
      sw += w; sx += w * x; sy += w * y; sxx += w * x * x; sxy += w * x * y
    })
    const slope = (sw * sxy - sx * sy) / Math.max(1e-12, sw * sxx - sx * sx)
    fit.push([slope, (sy - slope * sx) / sw])
  }
  const L = net.W.length - 1
  const J = 3
  const H = net.sizes[L]
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < H; i++) net.W[L][i * J + k] *= fit[k][0]
    net.b[L][k] = fit[k][0] * net.b[L][k] + fit[k][1]
  }
  return fit
}

// Fits V on the data: the network on the training runs (seed number ≢ 0, 1 mod 5), its rows drawn with the disaster
// battles' (lost and near-lost) made `disasters` of the draws; each epoch read on the validation runs (≡ 1), the best
// kept (early stopping, the step halved after two epochs without gain); recalibrated on validation; read on the held-out
// runs (≡ 0). → value.json's content.
async function fit (data, opts) {
  const V = await import('./value.js')
  const { D, n } = data
  const M = META.length
  const train = []
  const val = []
  const test = []
  for (let r = 0; r < n; r++) {
    const k = data.meta[r * M] % 5
    ;(k === 0 ? test : k === 1 ? val : train).push(r)
  }
  // Standardisation on the training rows, weighted.
  const mean = new Float64Array(D)
  const sd = new Float64Array(D)
  let W = 0
  for (const r of train) {
    const w = data.wt[r]
    W += w
    for (let j = 0; j < D; j++) mean[j] += w * data.X[r * D + j]
  }
  for (let j = 0; j < D; j++) mean[j] /= W
  for (const r of train) {
    const w = data.wt[r]
    for (let j = 0; j < D; j++) sd[j] += w * (data.X[r * D + j] - mean[j]) ** 2
  }
  for (let j = 0; j < D; j++) sd[j] = Math.sqrt(sd[j] / W) > 1e-6 ? Math.sqrt(sd[j] / W) : 1
  const isd = sd.map((v) => 1 / v)
  // The heads' base losses (the loss's units): P(won)'s at the base rate, the HP outputs' variances.
  const base = reading(data, train, new Float64Array(train.length * 3))
  const won = base.won
  const norms = [-(won * Math.log(clampP(won)) + (1 - won) * Math.log(clampP(1 - won))), base.monarchVar, base.ownVar]
  // The draws: each row its weight, the disaster battles' scaled to `disasters` of the whole.
  const q = new Float64Array(train.length)
  let dis = 0
  let all = 0
  train.forEach((r, i) => {
    q[i] = data.wt[r]
    all += q[i]
    if (data.meta[r * M + 4] > 0) dis += q[i]
  })
  const scale = dis > 0 && dis / all < opts.disasters ? opts.disasters / (1 - opts.disasters) * (all - dis) / dis : 1
  train.forEach((r, i) => { if (data.meta[r * M + 4] > 0) q[i] *= scale })
  const cum = new Float64Array(train.length)
  let acc = 0
  q.forEach((v, i) => { cum[i] = acc += v })
  const draw = (u) => {
    let lo = 0
    let hi = cum.length - 1
    const x = u * acc
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cum[mid] < x) lo = mid + 1
      else hi = mid
    }
    return train[lo]
  }
  console.log(`fit: ${n} positions (${train.length} train, ${val.length} validation, ${test.length} held out), ${D} features; the disaster battles ${(100 * dis / all).toFixed(1)}% of the training weight, drawn as ${(100 * dis * scale / (all - dis + dis * scale)).toFixed(1)}%`)
  console.log(`  base: P(won) ${won.toFixed(4)}, log-loss ${norms[0].toFixed(4)}; Monarch lost ${base.monarchVar.toFixed(5)} variance, pieces ${base.ownVar.toFixed(5)}`)
  const net = V.createNet({ inputs: D, hidden: [opts.hidden, opts.hidden], seed: opts.netSeed })
  const last = net.b[net.b.length - 1]
  last[0] = Math.log(clampP(won) / clampP(1 - won))
  last[1] = base.monarch
  last[2] = base.own
  const grads = V.gradsFor(net)
  const state = {}
  const rand = V.mulberry(opts.netSeed * 7919 + 1)
  const B = opts.batch
  const Xb = new Float64Array(B * D)
  const Yb = new Float64Array(B * 3)
  const idx = new Array(B)
  const acts = []
  let lr = opts.lr
  let best = null
  let since = 0
  const steps = Math.ceil(train.length / B)
  const copy = (nt) => ({ sizes: nt.sizes, W: nt.W.map((w) => w.slice()), b: nt.b.map((v) => v.slice()) })
  for (let epoch = 1; epoch <= opts.epochs; epoch++) {
    const t0 = Date.now()
    let loss = 0
    for (let s = 0; s < steps; s++) {
      for (let k = 0; k < B; k++) idx[k] = draw(rand())
      batchOf(data, idx, mean, isd, Xb, Yb)
      loss += V.batchLoss(net, Xb, Yb, B, norms, grads, null, acts)
      V.adam(net, grads, state, { lr, l2: opts.l2 })
    }
    const v = reading(data, val, outputsOn(V, net, data, val, mean, isd))
    const better = !best || v.score < best.v.score - 1e-4
    console.log(`  epoch ${epoch}: train ${(loss / steps).toFixed(4)}, validation ${v.score.toFixed(4)} (log-loss ${v.logLoss} against ${v.baseLogLoss}, AUC ${v.auc}, Monarch R² ${v.monarchR2}, pieces R² ${v.ownR2}), lr ${lr.toExponential(1)}, ${((Date.now() - t0) / 1000).toFixed(0)} s${better ? ' *' : ''}`)
    if (better) {
      best = { net: copy(net), v, epoch }
      since = 0
    } else if (++since % 2 === 0) lr /= 2
    if (since >= opts.patience) break
  }
  const out = best.net
  const cal = recalibrate(V, out, data, val, mean, isd)
  console.log(`  kept epoch ${best.epoch}; recalibrated on validation: ${JSON.stringify(cal.map(([a, c]) => [+a.toFixed(4), +c.toFixed(4)]))}`)
  const o = outputsOn(V, out, data, test, mean, isd)
  const held = reading(data, test, o, { calibration: true })
  const slice = (name, keep) => {
    const rows = []
    const os = []
    test.forEach((r, i) => {
      if (!keep(r)) return
      rows.push(r)
      os.push(o[i * 3], o[i * 3 + 1], o[i * 3 + 2])
    })
    if (!rows.length) return null
    const v = reading(data, rows, Float64Array.from(os))
    return { name, n: rows.length, auc: v.auc, logLoss: v.logLoss, baseLogLoss: v.baseLogLoss, monarchR2: v.monarchR2, ownR2: v.ownR2 }
  }
  held.slices = [
    slice('a turn\'s start', (r) => data.meta[r * M + 3] === 0),
    slice('an act\'s board', (r) => data.meta[r * M + 3] === 1),
    slice('End Turn\'s board', (r) => data.meta[r * M + 3] === 2),
    slice('floor 1', (r) => data.meta[r * M + 5] === 1),
    slice('disaster battles', (r) => data.meta[r * M + 4] > 0)
  ].filter(Boolean)
  // P(won) in lost battles against won ones.
  let pl = 0; let nl = 0; let pw = 0; let nw = 0
  test.forEach((r, i) => {
    const p = sigmoid(o[i * 3])
    if (data.Z[r]) { pw += p * data.wt[r]; nw += data.wt[r] } else { pl += p * data.wt[r]; nl += data.wt[r] }
  })
  held.meanWonInLost = +(pl / Math.max(1e-9, nl)).toFixed(4)
  held.meanWonInWon = +(pw / Math.max(1e-9, nw)).toFixed(4)
  console.log(`held out: ${JSON.stringify(held)}`)
  return V.toJSON(out, {
    mean,
    sd,
    made: {
      seed: opts.seed, runs: data.runs, positions: n, train: train.length, validation: val.length, test: test.length, lambda: opts.lambda,
      keep: KEEP, near: NEAR, disasters: opts.disasters, hidden: opts.hidden, epochs: best.epoch, lr: opts.lr, l2: opts.l2, batch: B,
      held: 'runs whose seed number is ≡ 0 (mod 5); validation ≡ 1', recalibration: cal
    },
    held
  })
}

// ── run directly ─────────────────────────────────────────────────────────────────────────────────

const JOBS = { play: playRun, positions: positionsOf }

if (!isMainThread && workerData?.kind && JOBS[workerData.kind]) {
  parentPort.on('message', async (item) => parentPort.postMessage(await JOBS[workerData.kind](item, workerData)))
} else if (isMainThread && process.argv[1] === decodeURIComponent(new URL(import.meta.url).pathname)) {
  const arg = (name, def) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  const seed = arg('seed', 'value')
  const runs = Number(arg('runs', 1000))
  const workers = Number(arg('workers', Math.max(1, Math.min(4, os.availableParallelism() - 2))))
  const dir = arg('data', path.join(os.tmpdir(), `retinue-value-${seed}`))
  fs.mkdirSync(dir, { recursive: true })
  const t0 = Date.now()
  // Stage 1.
  const runsFile = path.join(dir, 'runs.bin')
  const had = new Set(unpackAll(runsFile).map((r) => r.seed))
  const todo = Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`).filter((x) => !had.has(x))
  if (todo.length && !process.argv.includes('--no-play')) {
    console.log(`playing ${todo.length} expert runs (seeds ${seed}-1…${runs}, ${had.size} already in ${runsFile}) on ${workers} workers`)
    await pool('play', todo, workers, (r) => fs.appendFileSync(runsFile, pack(r)))
  }
  console.log(`play done, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (process.argv.includes('--play-only')) process.exit(0)
  // Stage 2.
  const V = await import('./value.js')
  const lambda = Number(arg('lambda', 1))
  const D = V.FEATURES.length
  const header = JSON.stringify({ features: V.FEATURES, keep: KEEP, near: NEAR, lambda, ...(lambda < 1 && { weights: V.weights()?.made ?? null }) })
  const posFile = path.join(dir, lambda < 1 ? `positions-td${lambda}.bin` : 'positions.bin')
  let have = readPositions(posFile, header, D)
  if (have === null) {
    console.log(`${posFile} was made otherwise (other features, thinning or λ): made again`)
    have = []
  }
  if (!have.length) fs.writeFileSync(posFile, header + '\n')
  const done = new Set(have.map((r) => r.seed))
  const wanted = new Set(Array.from({ length: runs }, (_, k) => `${seed}-${k + 1}`))
  const recs = unpackAll(runsFile).filter((r) => wanted.has(r.seed) && !done.has(r.seed))
  if (recs.length) {
    console.log(`positions: replaying ${recs.length} runs on ${workers} workers`)
    await pool('positions', recs, workers, (r) => fs.appendFileSync(posFile, packPositions(r)), { lambda })
  }
  const data = gather(readPositions(posFile, header, D).filter((r) => wanted.has(r.seed)), D)
  fs.writeFileSync(path.join(dir, 'disasters.json'), JSON.stringify(data.disasters))
  console.log(`${data.n} positions from ${data.runs} runs (${data.disasters.length} disaster battles: ${data.disasters.filter((d) => d.lost).length} lost), ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (process.argv.includes('--no-fit')) process.exit(0)
  // Stage 3.
  const json = await fit(data, {
    seed, lambda, epochs: Number(arg('epochs', 40)), patience: Number(arg('patience', 6)), hidden: Number(arg('hidden', 64)), batch: Number(arg('batch', 256)),
    lr: Number(arg('lr', 1e-3)), l2: Number(arg('l2', 1e-5)), disasters: Number(arg('disasters', 1 / 3)), netSeed: Number(arg('net-seed', 1))
  })
  const out = arg('out', new URL('./value.json', import.meta.url).pathname)
  fs.writeFileSync(out, JSON.stringify(json) + '\n')
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
}
