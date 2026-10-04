#!/usr/bin/env node
// Validate one pack against the loaded game and report patch overlaps (§16.2).
//
//   node tools/modcheck.js test/fixtures/kindled
//
// Two mods patching the same path is not an error (§13.2) — hard-failing on overlap is what makes
// large mod lists impossible. A shrug plus a good report is what makes them work, so this prints
// the overlaps and exits 0 unless the pack genuinely fails to load.

import { createGame } from '../src/sim/boot.js'
import { discoverPacks, readPackFromDisk, makeNodeImporter } from './packsource.node.js'
import { overlaps } from '../src/sim/mods/patch.js'
import { dirname, basename } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node tools/modcheck.js <pack-dir> [--trust]')
  process.exit(2)
}

const pack = readPackFromDisk(dir)
const trust = process.argv.includes('--trust')

const { report, kernel } = await createGame({
  packs: [...discoverPacks('packs'), pack],
  seed: 1,
  trusted: trust ? [pack.id] : [],
  importScript: makeNodeImporter(dirname(dir)),
  log: (...a) => console.log(...a)
})

console.log(`pack ${pack.id} v${pack.manifest.version} — ${pack.files.size} files`)
console.log(`load order: ${report.order.join(' → ')}`)

const mine = Object.fromEntries(
  kernel.registry.kinds()
    .map((k) => [k, kernel.registry.ids(k).filter((id) => id.startsWith(pack.id + ':')).length])
    .filter(([, n]) => n > 0)
)
console.log(`defines: ${Object.entries(mine).map(([k, n]) => `${n} ${k}`).join(', ') || '(no content)'}`)

const touched = [...new Set(report.patchLog.filter((e) => e.src === pack.id && e.op !== 'skip').map((e) => e.target))]
if (touched.length) console.log(`patches: ${touched.join(', ')}`)
if (report.scripts.length) console.log(`scripts: ${report.scripts.join(', ')}`)
else if (pack.manifest.scripts?.length && !trust) console.log('scripts: declared but not run (pass --trust)')

const clashes = overlaps(report.patchLog).filter((o) => o.packs.includes(pack.id))
if (clashes.length) {
  console.log(`\n${clashes.length} patch overlap(s) — coordinate with these authors:`)
  for (const c of clashes) console.log(`  ${c.where}  ←  ${c.packs.join(' + ')}`)
}

for (const w of report.warnings) console.log(`warn: ${w}`)
for (const d of report.disabled) console.log(`DISABLED ${d.id}: ${d.reason}`)
for (const e of report.errors) console.log(`ERROR ${e}`)

const ok = report.errors.length === 0 && !report.disabled.some((d) => d.id === pack.id)
console.log(ok ? `\n${basename(dir)} is loadable` : `\n${basename(dir)} did NOT load`)
process.exit(ok ? 0 : 1)
