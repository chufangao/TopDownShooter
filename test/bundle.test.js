// The expert as one file (src/sim/expert.json, bundle.js): its model tree at its top and its parts beside it, each read
// by its own module from there; a whole expert installed for a measurement (autoplay.js withExpert) and put back.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shippedFile, shippedPart, expertModel } from '../src/sim/expert.js'
import { forestModel } from '../src/sim/forest.js'
import { outForestModel } from '../src/sim/outforest.js'
import { routeModel, withExpert, playerOf, ROUTE_LEARNED } from '../src/sim/autoplay.js'
import { bundle, split, writePart, PARTS } from '../src/sim/bundle.js'

test('the shipped expert is one file: each module reads its part of it', () => {
  const file = shippedFile()
  assert.ok(file && file.tree && file.rules, 'the model tree at its top')
  assert.equal(expertModel().name, file.name)
  for (const k of PARTS) assert.equal(shippedPart(k), file[k] ?? null)
  assert.equal(forestModel()?.name ?? null, file.forest?.name ?? null)
  assert.equal(outForestModel()?.name ?? null, file.outforest?.name ?? null)
  if (ROUTE_LEARNED) assert.equal(routeModel()?.name ?? null, file.route?.name ?? null)
})

test('bundle and split: an expert file into its parts and back; a part set or dropped, the rest kept', () => {
  const file = shippedFile()
  const parts = split(file)
  assert.deepEqual(bundle({}, parts), file)
  const dropped = bundle(file, { forest: null })
  assert.equal(dropped.forest, undefined)
  assert.equal(dropped.outforest, file.outforest)
  assert.equal(dropped.name, file.name)
  // writePart replaces one part of a file and keeps the others.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retinue-bundle-'))
  try {
    const out = path.join(dir, 'expert.json')
    fs.writeFileSync(out, JSON.stringify(file))
    const route = { ...file.route, name: 'another' }
    writePart('route', route, out)
    const back = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.equal(back.route.name, 'another')
    assert.deepEqual(back.forest, file.forest)
    assert.deepEqual(back.tree, file.tree)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('withExpert: a whole expert in use at once (a part it lacks is none), every part put back after', () => {
  const file = shippedFile()
  const bare = bundle(file, { forest: null, outforest: null, route: null })
  const seen = withExpert(bare, () => ({ forest: forestModel(), outforest: outForestModel(), route: routeModel(), tree: expertModel().name }))
  assert.deepEqual(seen, { forest: null, outforest: null, route: null, tree: file.name })
  assert.equal(forestModel()?.name ?? null, file.forest?.name ?? null)
  assert.equal(outForestModel()?.name ?? null, file.outforest?.name ?? null)
  if (ROUTE_LEARNED) assert.equal(routeModel()?.name ?? null, file.route?.name ?? null)
  assert.deepEqual(playerOf('expert:/some/expert.json'), { expert: '/some/expert.json' })
})
