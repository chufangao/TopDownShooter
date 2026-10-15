// The store build:  npm run build  (node build.js [out], dist/ by default)
// dist/ is the game as it ships and nothing more, laid out as the source tree is (so every relative URL holds), with a
// service worker so the installed app plays offline. What ships (shipped): index.html, the manifest and its icons, the
// stylesheets, the font and the script index.html loads, every url() in those stylesheets, every module src/main.js
// reaches by its static imports, and src/assets/ whole (a unit's pictures are named at run time: content.js artUrl).
// Never the offline tools (OFFLINE: the labellers, the teachers, the fitters, the autoplayer's CLI), the expert's file
// (expert.json: in a browser the expert is today's scorer, and nothing in play runs it), the combo book, the tests,
// press/ or the docs; a game module that reached one would fail the build.
//
// The build's hash (sha256 of every file shipped, by path and content) names the service worker's cache and marks
// dist/index.html (<meta name="retinue-build">): main.js registers the worker only on a page so marked, so the source
// tree that npm start serves registers none. The worker (SW, written as dist/sw.js with the hash and the files)
// caches every file on install and serves them from its cache first; a page is asked of the network first, and one
// with no build's mark (the source tree served on the same origin) retires the worker and its cache. A new build's
// worker takes over once no page of the old one is open, and drops the old cache.
//
// Serve dist/ as the source tree is served:  node serve.js 5174 dist
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// What never ships: the offline tools (src/sim's labellers, teachers, fitters, the calculator and the autoplayer's
// CLI), the expert's file and the book they read.
export const OFFLINE = [
  'src/sim/teach.js', 'src/sim/outside.js', 'src/sim/fit.js', 'src/sim/outforest.js', 'src/sim/calc.js', 'src/sim/bundle.js',
  'src/sim/autoplay.js', 'src/sim/expert.json', 'src/sim/combos.json'
]

// A module's relative static imports and re-exports ('./x.js', '../y.js'), as written.
export function importsOf (text) {
  const out = []
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(?:[\w*{}\s,$]+?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm)) out.push(m[1])
  return out
}
// A stylesheet's url()s, relative ones alone ('data:' and absolute URLs aside).
const urlsOf = (css) => [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((m) => m[1]).filter((u) => !/^(data:|[a-z]+:|\/)/i.test(u))
const resolveFrom = (file, ref) => posix.normalize(posix.join(posix.dirname(file), ref.split(/[?#]/)[0]))
const walk = (root, dir) => readdirSync(join(root, dir)).flatMap((f) => {
  const p = posix.join(dir, f)
  return statSync(join(root, p)).isDirectory() ? walk(root, p) : [p]
})

// The files the game ships, relative to `root` (posix paths, sorted).
export function shipped (root = here) {
  const files = new Set()
  const read = (p) => readFileSync(join(root, p), 'utf8')
  const add = (p) => {
    if (!existsSync(join(root, p))) throw new Error(`build: ${p} is named but missing`)
    if (OFFLINE.includes(p)) throw new Error(`build: ${p} is an offline tool, and something the game ships reaches it`)
    files.add(p)
  }
  add('index.html')
  const html = read('index.html')
  const refs = [...html.matchAll(/<(?:link|script)\b[^>]*?\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(data:|[a-z]+:|\/)/i.test(u))
  // The modules: from each script index.html loads, every static import, the whole way down.
  const modules = (p) => {
    if (files.has(p)) return
    add(p)
    for (const spec of importsOf(read(p))) modules(resolveFrom(p, spec))
  }
  for (const ref of refs) {
    const p = posix.normalize(ref)
    if (p.endsWith('.js')) modules(p)
    else add(p)
    if (p.endsWith('.css')) for (const u of urlsOf(read(p))) add(resolveFrom(p, u))
    if (p.endsWith('.webmanifest')) for (const icon of JSON.parse(read(p)).icons ?? []) add(resolveFrom(p, icon.src))
  }
  for (const p of walk(root, 'src/assets')) add(p)
  return [...files].sort()
}

// The build's hash: sha256 over every file shipped, its path and its content (index.html before its mark).
export function hashOf (root, files) {
  const h = createHash('sha256')
  for (const f of files) h.update(`${f}\0`).update(readFileSync(join(root, f))).update('\0')
  return h.digest('hex').slice(0, 16)
}

// The service worker: BUILD and FILES filled in by the build (redesign.md §8, Step 9; the header says what it does).
const SW = `// RETINUE's service worker, written by build.js: build BUILD_HASH. Every file the build ships is cached on install under
// the build's own cache and served from it first, so the installed app plays offline. A page is asked of the network
// first: a page with no build's mark (the source tree served on this origin) retires this worker and its cache; any
// build's page is answered with this build's own, so a page and its files are always one build. A new build's worker
// takes over once no page of this one is open, and drops this cache.
const BUILD = 'BUILD_HASH'
const FILES = FILE_LIST
const CACHE = 'retinue-' + BUILD

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('retinue-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return
  e.respondWith(req.mode === 'navigate' ? page(req) : caches.match(req, { cacheName: CACHE, ignoreSearch: true }).then((hit) => hit || fetch(req)))
})
async function page (req) {
  const kept = () => caches.match('index.html', { cacheName: CACHE })
  let res
  try {
    res = await fetch(req)
  } catch {
    return (await kept()) || Response.error()
  }
  if (res.ok && !(await res.clone().text()).includes('name="retinue-build"')) {
    await self.registration.unregister()
    await Promise.all((await caches.keys()).filter((k) => k.startsWith('retinue-')).map((k) => caches.delete(k)))
    return res
  }
  return (await kept()) || res
}
`

// Builds into `out` (emptied first): the files shipped, index.html marked with the hash, sw.js. → { hash, files, bytes }
export function build (root = here, out = join(root, 'dist')) {
  const files = shipped(root)
  const hash = hashOf(root, files)
  rmSync(out, { recursive: true, force: true })
  let bytes = 0
  for (const f of files) {
    let body = readFileSync(join(root, f))
    if (f === 'index.html') body = Buffer.from(body.toString('utf8').replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta name="retinue-build" content="${hash}" />`))
    mkdirSync(dirname(join(out, f)), { recursive: true })
    writeFileSync(join(out, f), body)
    bytes += body.length
  }
  const sw = SW.replaceAll('BUILD_HASH', hash).replace('FILE_LIST', JSON.stringify(files, null, 2).replace(/"/g, '\''))
  writeFileSync(join(out, 'sw.js'), sw)
  bytes += Buffer.byteLength(sw)
  return { hash, files: [...files, 'sw.js'], bytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(here, 'dist'))
  const { hash, files, bytes } = build(here, out)
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`
  const by = (pred) => files.filter(pred).reduce((n, f) => n + statSync(join(out, f)).size, 0)
  console.log(`RETINUE build ${hash}: ${files.length} files, ${kb(bytes)} in ${relative(process.cwd(), out) || '.'}/`)
  console.log(`  modules ${files.filter((f) => f.endsWith('.js') && f !== 'sw.js').length} (${kb(by((f) => f.endsWith('.js') && f !== 'sw.js'))}, Phaser ${kb(by((f) => f.includes('vendor/')))}), ` +
    `art and font ${kb(by((f) => f.startsWith('src/assets/')))}, stylesheets ${kb(by((f) => f.endsWith('.css')))}`)
  console.log(`  serve it: node serve.js 5174 ${relative(process.cwd(), out) || '.'}`)
}
