// The run cache for autoplay.js playAll: a run is a pure function of the code, the expert and its job, so a finished
// run's record is kept on disk under a hash of the three and read back instead of playing it again.
// Layout: `<dir>/<code hash>/<key>.json.gz`, gzipped JSON, one file a run; deleting a directory clears it. Writes go
// through a temporary file and a rename, so two processes filling one cache never leave half a record.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

// Bumped when a record's shape changes without the code that makes it.
const VERSION = 1
const SRC = fileURLToPath(new URL('..', import.meta.url))
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex')

// The default directory: RETINUE_CACHE, else the user's cache (XDG_CACHE_HOME or ~/.cache) /retinue-runs.
export const defaultDir = () => process.env.RETINUE_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'retinue-runs')

// The code's hash under `root` (src/): every file of root/sim, names and bytes in name order, the root's modules those
// import (`from '../x.js'`), and Node's version. → hex
export function codeHash (root = SRC) {
  const h = crypto.createHash('sha256').update(`retinue-runs ${VERSION} ${process.version}\n`)
  const sim = path.join(root, 'sim')
  const outside = new Set()
  const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.isFile() ? [path.join(dir, e.name)] : []))
  for (const f of files(sim)) {
    const bytes = fs.readFileSync(f)
    h.update(`${path.relative(root, f)} ${bytes.length}\n`).update(bytes)
    if (f.endsWith('.js')) for (const m of bytes.toString('utf8').matchAll(/^(?:import\s[^\n]*|\}) from '\.\.\/([^']+)'/gm)) outside.add(m[1])
  }
  for (const m of [...outside].sort()) {
    const bytes = fs.readFileSync(path.join(root, m))
    h.update(`${m} ${bytes.length}\n`).update(bytes)
  }
  return h.digest('hex')
}

// A job's fields that name a file (a forest out of battle, a route): read by its bytes.
const FILES = ['outforest', 'route']
const NAMES = new Set(['none', 'hand', 'learned'])
// A job as its key reads it: its keys sorted, undefined ones dropped, each file it names as its bytes' hash (`files`
// caches path, size and time → hash).
function canonical (job, files) {
  const out = {}
  for (const k of Object.keys(job).sort()) {
    const v = job[k]
    if (v === undefined) continue
    if (FILES.includes(k) && typeof v === 'string' && !NAMES.has(v)) {
      const st = fs.statSync(v)
      const at = `${path.resolve(v)}|${st.size}|${st.mtimeMs}`
      if (!files.has(at)) files.set(at, `sha256:${sha(fs.readFileSync(v))}`)
      out[k] = files.get(at)
    } else out[k] = v
  }
  return out
}

// A cache in directory `dir` for the code under `root`. → { dir, code, key(job), get(key), put(key, record), hits: runs
// read, played: runs kept }
export function runCache ({ dir = defaultDir(), root = SRC } = {}) {
  const code = codeHash(root)
  const home = path.join(dir, code.slice(0, 16))
  const files = new Map()
  const file = (key) => path.join(home, `${key}.json.gz`)
  const cache = {
    dir,
    code,
    hits: 0,
    played: 0,
    key: (job) => sha(JSON.stringify([VERSION, code, canonical(job, files)])),
    // The record kept under `key`, or null (none, or one unreadable: played again).
    get (key) {
      try {
        const r = JSON.parse(zlib.gunzipSync(fs.readFileSync(file(key))).toString('utf8'))
        cache.hits++
        return r
      } catch {
        return null
      }
    },
    // Keeps `record` under `key`. → the record as a hit would read it back (JSON: no undefined fields)
    put (key, record) {
      const text = JSON.stringify(record)
      cache.played++
      try {
        fs.mkdirSync(home, { recursive: true })
        const tmp = `${file(key)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}`
        fs.writeFileSync(tmp, zlib.gzipSync(text))
        fs.renameSync(tmp, file(key))
      } catch {}
      return JSON.parse(text)
    }
  }
  return cache
}
