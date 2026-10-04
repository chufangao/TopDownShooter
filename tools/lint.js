#!/usr/bin/env node
// The content author's fast feedback loop, and the architecture's tripwire (§16.2, §18).
//
// Every def validated against its schema, every id reference resolved, every modifier path
// checked, every expr form known. Content bugs should be caught in under a second by a linter,
// never at tick time by a stack trace.
//
//   node tools/lint.js            # everything
//   node tools/lint.js --quiet    # only failures

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, resolve as resolvePath } from 'node:path'
import { createGame } from '../src/sim/boot.js'
import { discoverPacks, readPackFromDisk } from './packsource.node.js'
import { validate } from './schema.js'

const quiet = process.argv.includes('--quiet')
const results = []
const check = (name, problems, note = '') => results.push({ name, problems, note })

function walkFiles (dir, test, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walkFiles(full, test, out)
    else if (test(full)) out.push(full)
  }
  return out
}

const jsFiles = (dir) => walkFiles(dir, (f) => f.endsWith('.js'))

/** Comments are allowed to *name* the things these checks ban — that is how they get explained. */
function stripComment (line) {
  const trimmed = line.trim()
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return ''
  return line.replace(/\/\/.*$/, '')
}

// ── §18.1 — the rule the whole design rests on ─────────────────────────────────────────────────
{
  const bad = []
  for (const file of jsFiles('src/sim')) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      if (/^\s*import[^\n]*['"]phaser/i.test(line) || /require\(['"]phaser/i.test(line)) {
        bad.push(`${file}:${i + 1} imports Phaser`)
      }
    }
  }
  check('§18.1  no Phaser under src/sim/', bad)
}

// ── §18.15 — the renderer plays outcomes back; it never computes one ───────────────────────────
{
  // The twin of §18.1, pointing the other way. §18.1 stops the sim from importing the renderer;
  // this stops the renderer from quietly becoming the sim, which is how the run loop ended up
  // inside DungeonScene in the first place. Reading sim state is fine and expected — deciding it
  // is not, so the ban is on the verbs that resolve, not on the imports.
  // Two joined the list at M3.5 for the same reason `pickSpawns` did. Deciding that something is
  // worth reporting is a decision, and so is deciding whether a purchase is legal — `run.js` and
  // `tenet.js` make them, and the scene and the shop show what came back.
  const DECIDERS = ['runBattle', 'resolveTick', 'awardXp', 'gainXp', 'addRecruits', 'makeFoes',
    'generateFloor', 'pickSpawns', 'endRun', 'battleCoin', 'bankRun', 'raiseDispatches', 'buyTenet']
  const bad = []
  for (const file of jsFiles('src/engine').concat(jsFiles('src/ui'))) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      if (/^\s*(\/\/|\*)/.test(line)) continue
      for (const verb of DECIDERS) {
        if (line.includes(`${verb}(`)) bad.push(`${file}:${i + 1} calls ${verb}() — that decision belongs in src/sim/run.js`)
      }
    }
  }
  check('§18.15 the renderer never resolves, only plays back', bad)
}

// ── §18.16 — combat may write signals and may never read them ──────────────────────────────────
{
  // §4.3's one rule: "a signal may never be read by anything inside `resolveTick`." Profile-scoped
  // counters are save state, so a read here would make combat depend on how much the player had
  // played — and §18.5's determinism regression would start passing or failing according to save
  // history rather than according to the code.
  //
  // `signals.js` already makes it structurally hard: a battle gets `writeOnly(ledger)`, which has
  // one method on it. This is the second lock, and it is the one that catches a future refactor
  // that threads the real ledger through "just for a moment".
  const READS = ['signalCount', 'signalSince', 'hasTenet',
    'signals.count', 'signals.last', 'signals.recent', 'signals.snapshot', 'signals.save',
    'signals.wasAnswered', 'signals.wasRaised']
  const bad = []
  for (const file of [...jsFiles('src/sim/combat'), ...jsFiles('src/sim/policy')]) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      const code = stripComment(line)
      for (const read of READS) {
        if (code.includes(read)) bad.push(`${file}:${i + 1} reads the signal ledger (${read}) — combat writes signals and never reads them (§4.3)`)
      }
    }
  }
  check('§18.16 the sim writes signals and never reads them', bad)
}

// ── §18.2 — nondeterminism must be impossible, not discouraged ─────────────────────────────────
{
  // sandbox.js is the one file allowed to name these: its entire job is to make them throw
  // inside mod code (§13.3). It never calls them.
  const EXEMPT = new Set(['src/sim/mods/sandbox.js'])
  const banned = [/Math\.random\s*\(/, /Date\.now\s*\(/, /new Date\s*\(/, /performance\.now\s*\(/]
  const bad = []
  for (const file of [...jsFiles('src/sim'), ...(existsSync('tools/art.js') ? ['tools/art.js'] : [])]) {
    if (EXEMPT.has(file)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const [i, line] of lines.entries()) {
      const code = stripComment(line)
      for (const re of banned) if (re.test(code)) bad.push(`${file}:${i + 1} ${line.trim()}`)
    }
  }
  check('§18.2  no wall-clock or Math.random in the sim', bad)
}

// ── §18.12 — content cannot live under src/, and nothing may route around the loader ───────────
{
  const bad = []
  for (const f of walkFiles('src', (f) => f.endsWith('.json'))) bad.push(`${f} — content belongs in packs/`)
  for (const file of jsFiles('src')) {
    const src = readFileSync(file, 'utf8')
    for (const [i, line] of src.split('\n').entries()) {
      if (/^\s*import[^\n]*\.json['"]/.test(line)) bad.push(`${file}:${i + 1} imports a .json file directly`)
    }
  }
  // Tests live in test/, mirroring src/. Colocated tests drift out of the suite the moment the
  // runner's glob changes, and they make every "what is in src/" grep noisier than it needs to be.
  for (const f of jsFiles('src')) {
    if (f.endsWith('.test.js')) bad.push(`${f} — tests belong under test/`)
  }
  check('§18.12 no content under src/, no path around the loader', bad)
}

// ── §18.9 — line count as a design alarm, on every file that decides anything ──────────────────
{
  // The alarm exists because a file that grows is a file that absorbed something which should have
  // been an op, a hook or a data row. `resolve.js` is the one §18.9 names; the other two were
  // carrying the same risk with no alarm, which §19 listed as a debt. `rules.js` is the smallest
  // and the most important: it holds the only game rules in the sim written as JavaScript.
  const BUDGETS = [
    ['src/sim/combat/resolve.js', 250, 'something that should be an op or a hook got hardcoded'],
    ['src/sim/combat/battle.js', 320, 'the arrangement layer is absorbing rules — move them to rules.js or to data'],
    // Raised from 120 to 145 when `core:phases` landed (§6.3). The alarm's own criterion is "why is
    // this not a status, a Resonance or a Pact?", and the answer here is that it is the thing which
    // *applies* one — the same category as `core:effect_rows`, not a fifth special case. A fifth
    // rule still has to make that argument, and now has ~25 lines to make it in.
    ['src/sim/combat/rules.js', 145, 'a fifth core rule must justify why it is not a status, a Resonance or a Pact']
  ]
  const bad = []
  const notes = []
  for (const [f, budget, why] of BUDGETS) {
    if (!existsSync(f)) { notes.push(`${f.split('/').pop()} —`); continue }
    const src = readFileSync(f, 'utf8')
    const n = src.split('\n').length
    // Reported alongside the raw count because this codebase is deliberately about a third
    // comments, and a raw line count read on its own has sent a previous audit chasing a file that
    // was well inside its budget.
    const code = codeLines(src)
    notes.push(`${f.split('/').pop()} ${n}/${budget} (${code} code)`)
    if (n > budget) bad.push(`${f} is ${n} lines against a ${budget} budget — ${why}`)
  }
  check('§18.9  the deciding files stay small', bad, notes.join(', '))
}

/** Lines that are neither blank nor comment. The honest denominator for a size budget. */
function codeLines (src) {
  let n = 0
  let block = false
  for (const raw of src.split('\n')) {
    const l = raw.trim()
    if (block) { if (l.includes('*/')) block = false; continue }
    if (!l || l.startsWith('//')) continue
    if (l.startsWith('/*')) { if (!l.includes('*/')) block = true; continue }
    n++
  }
  return n
}

// ── §18.10 — the migration chain has something true to be tested against ───────────────────────
{
  // The test does the walking (`test/sim/save.test.js`); this asserts the corpus it walks is real
  // and stays real. A migration chain with no committed fixture below the current version is a
  // chain whose only assertion is about fiction — so the moment SAVE_VERSION moves, this fails
  // until the fixture for the version it left behind is committed.
  const bad = []
  let note = 'save.js not built yet (M4)'
  if (existsSync('src/sim/migrations.js')) {
    const { SAVE_VERSION, MIGRATIONS } = await import('../src/sim/migrations.js')
    const dir = 'test/fixtures/saves'
    const versions = (existsSync(dir) ? readdirSync(dir) : [])
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).v)
      .sort((a, b) => a - b)

    if (!versions.length) bad.push(`no save fixtures under ${dir}/ — §14 requires v1 frozen the day save.js landed`)
    for (const m of MIGRATIONS) {
      if (!versions.some((v) => v < m.to)) bad.push(`migration to v${m.to} has no fixture below it to migrate`)
    }
    if (MIGRATIONS.length && MIGRATIONS[MIGRATIONS.length - 1].to > SAVE_VERSION) {
      bad.push(`MIGRATIONS reaches v${MIGRATIONS[MIGRATIONS.length - 1].to} but SAVE_VERSION is ${SAVE_VERSION}`)
    }
    note = `save v${SAVE_VERSION}, ${MIGRATIONS.length} migration(s), fixtures ${versions.map((v) => `v${v}`).join(' ') || '—'}`
  }
  check('§18.10 save fixtures cover the migration chain', bad, note)
}

// ── §18.14 — content is plain JSON and validates against its $schema ───────────────────────────
const packDirs = existsSync('packs')
  ? readdirSync('packs').sort().map((d) => join('packs', d)).filter((d) => existsSync(join(d, 'mod.json')))
  : []
{
  const bad = []
  let checked = 0
  for (const dir of packDirs) {
    for (const file of walkFiles(join(dir, 'content'), (f) => f.endsWith('.json'))) {
      let doc
      try {
        doc = JSON.parse(readFileSync(file, 'utf8'))
      } catch (e) {
        bad.push(`${file}: not valid JSON — ${e.message}`)
        continue
      }
      checked++
      if (typeof doc.$schema !== 'string') {
        bad.push(`${file}: no $schema — editors cannot autocomplete or red-underline this file`)
        continue
      }
      const schemaPath = resolvePath(dirname(file), doc.$schema)
      if (!existsSync(schemaPath)) { bad.push(`${file}: $schema ${doc.$schema} does not exist`); continue }
      const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
      for (const e of validate(doc, schema)) bad.push(`${file} ${e}`)
    }
  }
  check('§18.14 content is plain JSON, validated by its $schema', bad, `${checked} files`)
}

// ── formatting: content is hand-edited, so it gets one canonical shape ─────────────────────────
{
  const bad = []
  let note = ''
  try {
    note = execFileSync('node', ['tools/fmt.js', '--check'], { encoding: 'utf8' }).trim().split('\n').pop()
  } catch (e) {
    bad.push(...String(e.stderr ?? e.stdout ?? e.message).trim().split('\n').filter(Boolean))
  }
  check('        pack JSON is formatted (npm run fmt)', bad, note)
}

// ── §18.3/4 — the real proof: load every pack through the public entry point ───────────────────
let game = null
{
  const packs = discoverPacks('packs')
  const fixture = 'test/fixtures'
  if (existsSync(fixture)) {
    for (const name of readdirSync(fixture).sort()) {
      if (existsSync(join(fixture, name, 'mod.json'))) packs.push(readPackFromDisk(join(fixture, name)))
    }
  }
  game = await createGame({ packs, seed: 1 })
  check('§18.3/4 loads: no bare ids, no dangling references', game.report.errors,
    `${packs.length} pack(s), contentHash ${game.report.contentHash ?? '—'}`)
  for (const w of game.report.warnings) if (!quiet) console.log(`  warn: ${w}`)
  for (const d of game.report.disabled) if (!quiet) console.log(`  disabled ${d.id}: ${d.reason}`)
}

// ── §18.6 — mod-order fuzz: the moddability twin of the determinism test ───────────────────────
{
  const bad = []
  const base = game?.report?.contentHash
  if (base) {
    const packs = discoverPacks('packs')
    const fixture = 'test/fixtures'
    if (existsSync(fixture)) {
      for (const name of readdirSync(fixture).sort()) {
        if (existsSync(join(fixture, name, 'mod.json'))) packs.push(readPackFromDisk(join(fixture, name)))
      }
    }
    // Rotations are enough here; test/modorder.test.js does the randomised permutations.
    for (let r = 1; r < Math.min(packs.length, 6); r++) {
      const rotated = [...packs.slice(r), ...packs.slice(0, r)]
      const { report } = await createGame({ packs: rotated, seed: 1 })
      if (report.contentHash !== base) bad.push(`rotation ${r} produced contentHash ${report.contentHash}, expected ${base}`)
    }
  }
  check('§18.6  registry hash is independent of pack order', bad)
}

// ── §18.13 — re-bake and compare hashes; stale committed art fails the build ───────────────────
{
  const bad = []
  let note = 'art baker not built yet (K2)'
  if (existsSync('tools/art.js')) {
    try {
      note = execFileSync('node', ['tools/art.js', '--check'], { encoding: 'utf8' }).trim().split('\n').pop()
    } catch (e) {
      bad.push(...String(e.stderr ?? e.stdout ?? e.message).trim().split('\n'))
      note = ''
    }
  }
  check('§18.13 baked art is fresh', bad, note)
}

// ── report ────────────────────────────────────────────────────────────────────────────────────
let failed = 0
for (const r of results) {
  const ok = r.problems.length === 0
  if (!ok) failed++
  if (!quiet || !ok) {
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.note ? `  (${r.note})` : ''}`)
  }
  for (const p of r.problems.slice(0, 25)) console.log(`        ${p}`)
  if (r.problems.length > 25) console.log(`        … and ${r.problems.length - 25} more`)
}

if (game?.report) {
  const counts = Object.entries(game.report.counts).sort().map(([k, n]) => `${n} ${k}`).join(', ')
  if (!quiet && counts) console.log(`\ncontent: ${counts}`)
}
console.log(failed === 0 ? '\nlint passed' : `\nlint failed — ${failed} check(s)`)
process.exit(failed === 0 ? 0 : 1)
