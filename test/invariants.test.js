// §18 — the invariants, run as part of `npm test` rather than only in CI.
//
// Each exists because violating it silently is easy and expensive. `tools/lint.js` is the
// implementation; this test is what makes it impossible to skip.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('tools/lint.js passes — architecture, content and load invariants', () => {
  let out
  try {
    out = execFileSync('node', ['tools/lint.js', '--quiet'], { encoding: 'utf8' })
  } catch (e) {
    assert.fail(`lint failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`)
  }
  assert.match(out, /lint passed/)
})
