// The store build:  npm run build  (node build.js [out], dist/ by default); serve it with  node serve.js 5174 dist
// dist/ is the game as it ships, laid out as the source tree is (so every relative URL holds): index.html, the manifest
// and its icons, the stylesheets and what they name, every module src/main.js reaches, and src/assets/ whole; never an
// offline tool (OFFLINE: a game module that reached one fails the build).
// The build's hash names the service worker's cache and marks dist/index.html; main.js registers the worker only on a
// marked page. The worker (SW) caches every file on install and serves them offline, a page from the network first.
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, relative, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// What never ships: the offline tools, the autoplayer's model files and the combo book.
export const OFFLINE = [
  'src/sim/outside.js', 'src/sim/forestfit.js', 'src/sim/outforest.js', 'src/sim/values.js', 'src/sim/trees.js',
  'src/sim/autoplay.js', 'src/sim/player.js', 'src/sim/reports.js', 'src/sim/sequential.js', 'src/sim/runcache.js', 'src/sim/pool.js', 'src/sim/cli.js',
  'src/sim/outforest.json', 'src/sim/route.json', 'src/sim/combos.json',
  // The autoplayer's reads and the expert's battle play (the game plays the foes by foe.js alone).
  'src/sim/read.js', 'src/sim/solver.js'
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

// The service worker: BUILD and FILES filled in by the build.
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
