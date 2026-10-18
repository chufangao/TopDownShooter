// The store build (build.js): dist/ holds every file the game loads, by any static import from
// src/main.js and by index.html, its stylesheets and its manifest, and every picture a unit is drawn by; never the
// offline tools, the expert's file, the tests or press/; its page marked with the build's hash, and a service worker
// caching exactly what ships.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import { shipped, build, importsOf, OFFLINE } from '../build.js'
import { UNIT_LIST, ART_POSES, artUrl } from '../src/content.js'

const root = new URL('..', import.meta.url).pathname
const files = shipped(root)
const has = new Set(files)

test('the build ships every module the game imports, the whole way down from main.js', () => {
  const js = files.filter((f) => f.endsWith('.js'))
  // Closed: every relative import or re-export of a module shipped is shipped, read by a pattern of its own here.
  for (const f of js) {
    const text = readFileSync(join(root, f), 'utf8')
    const specs = [...text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? m[2])
    assert.deepEqual(new Set(importsOf(text)), new Set(specs.filter((s) => s.startsWith('.'))), f)
    for (const s of specs) assert.ok(has.has(posix.normalize(posix.join(posix.dirname(f), s))), `${f} imports ${s}`)
  }
  for (const f of ['src/main.js', 'src/ui.js', 'src/engine.js', 'src/board.js', 'src/music.js', 'src/sfx.js', 'src/vendor/phaser.js',
    'src/sim/run.js', 'src/sim/turns.js', 'src/sim/foe.js', 'src/sim/save.js', 'src/sim/history.js', 'src/content.js', 'src/tuning.js']) {
    assert.ok(has.has(f), f)
  }
})

test('the build ships what the page loads: its stylesheets and what they name, the font, the manifest and its icons, every unit\'s pictures', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8')
  for (const [, href] of html.matchAll(/<link\b[^>]*?\bhref="([^"]+)"/g)) if (!href.startsWith('data:')) assert.ok(has.has(href), href)
  for (const css of files.filter((f) => f.endsWith('.css'))) {
    for (const [, u] of readFileSync(join(root, css), 'utf8').matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
      if (!u.startsWith('data:')) assert.ok(has.has(posix.normalize(posix.join(posix.dirname(css), u))), `${css}: ${u}`)
    }
  }
  for (const icon of JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8')).icons) assert.ok(has.has(icon.src), icon.src)
  const base = new URL('../src/', import.meta.url).href
  for (const u of UNIT_LIST) for (const pose of ART_POSES) assert.ok(has.has('src/' + artUrl(u.id, pose).slice(base.length)), `${u.id} ${pose}`)
  for (const p of ['floor', 'wall-0', 'wall-1', 'wall-2']) assert.ok(has.has(`src/assets/props/${p}.svg`), p)
  assert.ok(has.has('src/assets/fonts/OFL.txt'), 'the font\'s licence with it')
})

test('the build never ships the offline tools (the forest\'s fitting among them), the expert\'s file, the tests, press/ or the docs', () => {
  for (const f of ['src/sim/teach.js', 'src/sim/outside.js', 'src/sim/fit.js', 'src/sim/forestfit.js', 'src/sim/outforest.js', 'src/sim/expert.json', 'src/sim/autoplay.js', 'src/sim/player.js', 'src/sim/reports.js', 'src/sim/calc.js',
    'src/sim/policy.js', 'src/sim/plan.js', 'src/sim/expert.js', 'src/sim/forest.js', 'src/sim/pool.js', 'src/sim/cli.js']) {
    assert.ok(OFFLINE.includes(f) && !has.has(f), f)
  }
  // No module shipped grows a tree, bins a column or reads a label.
  for (const f of files.filter((f) => f.endsWith('.js') && !f.includes('vendor/'))) {
    assert.ok(!/\bfunction\s*\*?\s*(growTrees?|fitForest|readTable|cutsOf|linesOf|decisionsOf)\b/.test(readFileSync(join(root, f), 'utf8')), f)
  }
  assert.ok(!files.some((f) => /^(test|press|dist)\/|\.md$|^(package\.json|serve\.js|build\.js)$/.test(f)), files.filter((f) => /^(test|press)\//.test(f)).join())
  // A game module that reached an offline tool would fail the build.
  const fake = fakeRoot()
  try {
    assert.throws(() => shipped(fake), /offline tool/)
  } finally {
    rmSync(fake, { recursive: true, force: true })
  }
})

// A page whose main.js imports the autoplayer: the build refuses it.
function fakeRoot () {
  const dir = mkdtempSync(join(tmpdir(), 'retinue-build-'))
  const write = (p, text) => { mkdirSync(join(dir, posix.dirname(p)), { recursive: true }); writeFileSync(join(dir, p), text) }
  write('index.html', '<script type="module" src="src/main.js"></script>')
  write('src/main.js', "import { policy } from './sim/autoplay.js'\n")
  write('src/sim/autoplay.js', '')
  write('src/assets/x.svg', '')
  return dir
}

test('dist: the files shipped, the page marked with the build\'s hash, a service worker caching exactly them', () => {
  const out = mkdtempSync(join(tmpdir(), 'retinue-dist-'))
  try {
    const { hash, files: built } = build(root, out)
    assert.match(hash, /^[0-9a-f]{16}$/)
    assert.deepEqual(built, [...files, 'sw.js'])
    for (const f of built) assert.ok(existsSync(join(out, f)), f)
    const page = readFileSync(join(out, 'index.html'), 'utf8')
    assert.ok(page.includes(`<meta name="retinue-build" content="${hash}" />`))
    assert.equal(page.replace(/\s*<meta name="retinue-build"[^>]*>/, ''), readFileSync(join(root, 'index.html'), 'utf8'))
    const sw = readFileSync(join(out, 'sw.js'), 'utf8')
    assert.ok(sw.includes(`const BUILD = '${hash}'`))
    const listed = JSON.parse(sw.match(/const FILES = (\[[\s\S]*?\])\n/)[1].replace(/'/g, '"'))
    assert.deepEqual(listed, files)
    // The same tree builds to the same hash.
    assert.equal(build(root, out).hash, hash)
    // The source page has no mark: npm start registers no worker.
    assert.ok(!readFileSync(join(root, 'index.html'), 'utf8').includes('retinue-build'))
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
})
