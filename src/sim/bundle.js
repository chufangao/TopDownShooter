// The expert as one file (2026-10-13; the user: "combine"): src/sim/expert.json, its model tree at its top (expert.js:
// name, about, tree, rules) and its other parts beside it, each the configuration its module reads (expert.js
// shippedFile): `forest` the battle forest (forest.js), `outforest` the forests out of battle (outforest.js: the
// recruit, the formation), `route` the learned route (autoplay.js). Offline only, like the fitters that make the parts:
// never imported by the expert's play code.
//
//   npm run bundle -- [--tree file] [--forest file|none] [--outforest file|none] [--route file|none] [--from file]
//                     [--out src/sim/expert.json] [--name …] [--about …] [--dry]
// starts from `--from` (the shipped expert.json by default), sets each part given (a file of that part's own shape,
// or none to drop it; `--tree` a model tree's file: its name, about, tree, rules, options), and writes `--out`. A part
// not given is kept as it was. `--split dir`: the other way, each part of `--from` written to dir as its own file
// (tree.json, forest.json, outforest.json, route.json), for a fitter or a measurement that reads a part alone.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkModel } from './expert.js'

export const SHIPPED = fileURLToPath(new URL('./expert.json', import.meta.url))
// The parts beside the model tree, in the file's order.
export const PARTS = Object.freeze(['forest', 'outforest', 'route'])
// The model tree's own keys at the file's top.
const TREE_KEYS = ['name', 'about', 'options', 'tree', 'rules']

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

// An expert file from `base` (an expert file's contents) with `set` over it: { tree?, forest?, outforest?, route? },
// each a configuration, or null to drop that part. → the file's contents (its tree checked).
export function bundle (base, set = {}) {
  const out = {}
  const tree = set.tree ?? base
  for (const k of TREE_KEYS) if (tree?.[k] !== undefined) out[k] = tree[k]
  checkModel(out)
  for (const k of PARTS) {
    const x = k in set ? set[k] : base?.[k]
    if (x) out[k] = x
  }
  return out
}

// An expert file's parts, each as its own configuration: { tree, forest?, outforest?, route? }.
export function split (file) {
  const out = { tree: Object.fromEntries(TREE_KEYS.filter((k) => file[k] !== undefined).map((k) => [k, file[k]])) }
  for (const k of PARTS) if (file[k]) out[k] = file[k]
  return out
}

// Writes the expert file `out` with part `name` replaced by `config` (the fitters' way to ship one part).
export function writePart (name, config, out = SHIPPED) {
  const base = fs.existsSync(out) ? read(out) : {}
  const file = bundle(base, name === 'tree' ? { tree: config } : { [name]: config })
  fs.writeFileSync(out, JSON.stringify(file) + '\n')
  return file
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, def = null) => {
    const i = process.argv.indexOf('--' + name)
    return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
  }
  const from = read(arg('from', SHIPPED))
  if (arg('split')) {
    const dir = arg('split')
    fs.mkdirSync(dir, { recursive: true })
    for (const [k, x] of Object.entries(split(from))) fs.writeFileSync(path.join(dir, `${k}.json`), JSON.stringify(x) + '\n')
    console.log(`split into ${dir}: ${Object.keys(split(from)).join(', ')}`)
  } else {
    const set = {}
    if (arg('tree')) set.tree = read(arg('tree'))
    for (const k of PARTS) if (arg(k)) set[k] = arg(k) === 'none' ? null : read(arg(k))
    const file = bundle(from, set)
    if (arg('name')) file.name = arg('name')
    if (arg('about')) file.about = arg('about')
    const out = arg('out', SHIPPED)
    if (!process.argv.includes('--dry')) fs.writeFileSync(out, JSON.stringify(file) + '\n')
    console.log(`${process.argv.includes('--dry') ? 'would write' : 'written'} ${out}: the tree "${file.name}"${PARTS.map((k) => (file[k] ? `, ${k} "${file[k].name ?? 'unnamed'}"` : '')).join('')}`)
  }
}
