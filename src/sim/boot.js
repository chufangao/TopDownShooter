// Boot — the single public entry point into a loaded game (invariant §18.12).
//
// `packs/core/` and a stranger's pack both arrive here as `createPack()` results and go through
// exactly the same loader. There is deliberately no other way to get content into the registry.
//
// Pure JS: this runs in the browser, in a Web Worker (§1 loop D) and in Node (tools/, tests).

import { createKernel, createStatSchema, HOOK_POINTS } from './kernel/index.js'
import { loadPacks } from './mods/loader.js'
import { contentKinds, STAT_PATHS } from './content/kinds.js'
import { registerCoreOps } from './content/ops.js'
import { registerDomainForms } from './content/forms.js'
import { registerCoreRules } from './combat/rules.js'
import { unitBaseStats } from './party.js'

/** The effective tuning def. Core ships it; any pack may patch it (§16.1). */
export const TUNING_ID = 'core:tuning'
export const getTuning = (registry) => registry.get('tuning', TUNING_ID)

export { unitBaseStats }

function registerInstanceKinds (kernel) {
  kernel.defs.registerKind('unit', {
    orphanPolicy: 'drop',
    make (def, ctx) {
      const lvl = ctx.lvl ?? 1
      const stats = unitBaseStats(def, lvl)
      return {
        lvl,
        xp: 0,
        star: ctx.star ?? 1,
        hp: stats.hp,
        maxHp: stats.hp,
        gauge: 0,
        slot: ctx.slot ?? -1,
        side: ctx.side ?? 'party',
        statuses: [],
        branch: [],
        persuadeAttempts: 0,
        /** How many of the def's `phases` have fired (§6.3). Reset at the start of every battle. */
        phase: 0,
        pinned: false
      }
    }
  })
}

/**
 * @param {object} opts
 * @param {Array} opts.packs      `createPack()` results, in any order
 * @param {number|string} [opts.seed]
 * @param {boolean} [opts.allowScripts]  tier 3 off by default — trust is per pack (§13.3)
 * @param {string[]} [opts.trusted]
 * @param {Function} [opts.importScript]
 * @returns {Promise<{kernel, report, tuning}>}
 */
export async function createGame ({
  packs,
  seed = 0,
  allowScripts = false,
  trusted = [],
  importScript = null,
  log = () => {}
} = {}) {
  const kernel = createKernel(seed)

  // Verbs, forms and the core rule set first: content is validated against them as it loads, and
  // the rules subscribe to the same bus a mod script would (§11.5).
  registerCoreOps(kernel.ops)
  registerDomainForms(kernel.forms)
  registerCoreRules(kernel)

  const statSchema = createStatSchema(STAT_PATHS)
  const kinds = contentKinds({ statSchema, hookPoints: HOOK_POINTS })
  registerInstanceKinds(kernel)

  const report = await loadPacks(packs, kernel, { kinds, allowScripts, trusted, importScript, log })

  return {
    kernel,
    report,
    statSchema,
    tuning: report.errors.length === 0 && kernel.registry.has('tuning', TUNING_ID)
      ? getTuning(kernel.registry)
      : null
  }
}
