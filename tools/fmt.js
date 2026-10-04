#!/usr/bin/env node
// Format pack JSON the way a content author wants to read it (§16.1).
//
//   node tools/fmt.js            # rewrite every pack JSON in place
//   node tools/fmt.js --check    # fail if anything is unformatted (CI, pre-commit)
//
// Two rules, and they exist because content files are edited by hand:
//   * arrays of scalars stay on one line — `"variance": [0.95, 1.05]`, and more importantly an
//     expression tree like `["gte", ["enemyCount"], 2]` reads as one thought instead of eight rows
//   * everything else is 2-space indented, key order preserved
//
// Anything wider than the wrap column falls back to expanded form, so a long ability's effects
// still break across lines.

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const WRAP = 118
const check = process.argv.includes('--check')

const isScalarArray = (v) => Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')

function fmt (value, indent = 0) {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)

  if (value === null || typeof value !== 'object') return JSON.stringify(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    if (isScalarArray(value)) {
      const line = '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']'
      if (indent + line.length <= WRAP) return line
    }
    // A nested expression tree is still one thought — keep it inline when it fits.
    const flat = '[' + value.map((v) => fmt(v, 0).replace(/\s*\n\s*/g, ' ')).join(', ') + ']'
    if (!flat.includes('"_note"') && indent + flat.length <= WRAP) return flat
    return '[\n' + value.map((v) => inner + fmt(v, indent + 2)).join(',\n') + '\n' + pad + ']'
  }

  const keys = Object.keys(value)
  if (keys.length === 0) return '{}'
  const flat = '{ ' + keys.map((k) => JSON.stringify(k) + ': ' + fmt(value[k], 0).replace(/\s*\n\s*/g, ' ')).join(', ') + ' }'
  if (!flat.includes('"_note"') && !flat.includes('\n') && indent + flat.length <= WRAP) return flat
  return '{\n' + keys.map((k) => inner + JSON.stringify(k) + ': ' + fmt(value[k], indent + 2)).join(',\n') + '\n' + pad + '}'
}

const format = (text) => fmt(JSON.parse(text), 0) + '\n'

/**
 * Save fixtures are frozen artefacts, not content (§14). A fixture's whole value is that it is what
 * an old build actually wrote, so reformatting one — even by whitespace alone — quietly edits the
 * evidence the migration chain is tested against.
 */
const SKIP = ['test/fixtures/saves']

function collect (dir, out = []) {
  if (!existsSync(dir) || SKIP.includes(dir)) return out
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (p.endsWith('.json')) out.push(p)
  }
  return out
}

const roots = ['packs', 'test/fixtures']
const files = roots.flatMap((r) => collect(r))
const stale = []

for (const file of files) {
  const before = readFileSync(file, 'utf8')
  let after
  try {
    after = format(before)
  } catch (e) {
    console.error(`${file}: not valid JSON — ${e.message}`)
    process.exit(1)
  }
  if (before === after) continue
  stale.push(file)
  if (!check) writeFileSync(file, after)
}

if (check) {
  for (const f of stale) console.error(`${f} is unformatted`)
  console.log(stale.length === 0 ? `${files.length} files formatted` : `${stale.length} file(s) need \`npm run fmt\``)
  process.exit(stale.length === 0 ? 0 : 1)
}
console.log(stale.length ? `formatted ${stale.length}/${files.length} files` : `${files.length} files already formatted`)
