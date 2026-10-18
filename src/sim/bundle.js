// The expert as one file, src/sim/expert.json: the model tree (name, about, options, tree, rules) at its top and beside
// it the parts `forest` (the battle forest), `outforest` (the forests out of battle) and `route` (the learned route).
// Offline only: the expert's play code never imports it.
//
//   npm run bundle -- [--from file] [--tree file] [--forest|--outforest|--route file|none] [--out file] [--name …] [--about …] [--dry] [--split dir]
//   --from       the file to start from (the shipped expert.json by default); a part not given is kept
//   --tree       a model tree's file (name, about, tree, rules, options)
//   --forest, --outforest, --route   that part's own file, or none to drop it
//   --out        the file written (src/sim/expert.json by default); --dry writes nothing
//   --split dir  the other way: each part of --from written to dir as its own file (tree.json, forest.json, …)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkModel } from './expert.js'
import { arg, has, isMain } from './cli.js'

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

if (isMain(import.meta.url)) {
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
    if (!has('dry')) fs.writeFileSync(out, JSON.stringify(file) + '\n')
    console.log(`${has('dry') ? 'would write' : 'written'} ${out}: the tree "${file.name}"${PARTS.map((k) => (file[k] ? `, ${k} "${file[k].name ?? 'unnamed'}"` : '')).join('')}`)
  }
}
