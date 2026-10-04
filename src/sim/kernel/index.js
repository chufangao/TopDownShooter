// The kernel, assembled. Seven primitives (§11) and nothing else — everything under src/sim/ is
// content, policy, or a thin arrangement of these.
//
// Nothing here may import Phaser (§18.1) or read a clock (§18.2).

import { createRegistry } from './registry.js'
import { createInstancer } from './defs.js'
import { createOps } from './ops.js'
import { createHooks } from './hooks.js'
import { standardForms } from './expr.js'
import { makeRng } from './rng.js'

export { createRegistry, ID_RE, assertId, namespaceOf, stableStringify, digest } from './registry.js'
export { createInstancer, ORPHAN_POLICIES } from './defs.js'
export { resolveStats, createStatSchema, validateModifier, getPath, setPath, OPS } from './modifiers.js'
export { createOps } from './ops.js'
export { createHooks, HOOK_POINTS } from './hooks.js'
export { createForms, standardForms, registerStandardForms } from './expr.js'
export { makeRng, hashString } from './rng.js'

/**
 * One kernel instance = one loaded game. Boot creates it, the pack loader fills it, then
 * `freeze()` closes it before the first tick (§11.1, invariant §18.8).
 */
export function createKernel (seed = 0) {
  const registry = createRegistry()
  const kernel = {
    registry,
    defs: createInstancer(registry),
    ops: createOps(),
    hooks: createHooks(),
    forms: standardForms(),
    rng: makeRng(seed),
    /** Reseed for a new run without rebuilding the registry. */
    reseed (newSeed) { kernel.rng = makeRng(newSeed); return kernel },
    freeze () {
      registry.freeze()
      kernel.ops.freeze()
      kernel.hooks.freeze()
      kernel.forms.freeze()
      return kernel
    },
    get frozen () { return registry.frozen }
  }
  return kernel
}
