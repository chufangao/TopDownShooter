// Rule instrumentation (§4.1) — the entire debugging story for authored policy.
//
// > Every rule shows a live fire count. A rule that never fires is the single most common authoring
// > bug and is otherwise completely invisible — the badge reads `0` in amber and that is the entire
// > debugging story. Clicking it opens the last three evaluations with each sub-expression's value
// > shown inline, so `0` becomes "`kinCount(Drake)` was 4, not < 4".
//
// This ships *before* the editors on purpose. An editor without it is a text field that silently
// does nothing, and "why didn't my rule fire" is unanswerable without the sub-expression values.
//
// Two properties it has to have, and the reasons they are not negotiable:
//
//   * **Zero cost when off.** The battle fuzzer runs 10,000 battles (§18.11) and the balance
//     harness thousands more; neither may pay for instrumentation it does not read. A null trace is
//     an absent property on ctx, so the hot path is one `?.` and no allocation.
//   * **Bounded when on.** `recruitVerdict` runs per candidate per gauge fill — capturing every
//     evaluation would allocate megabytes in a long fight. Counters are integers; only the first
//     few evaluations of each rule *per battle* keep their sub-expression values.
//
// Pure JS. No clock, no Math.random, no Phaser.

/** How many worked evaluations each rule keeps per battle. §4.1 asks for the last three. */
export const SAMPLES_PER_RULE = 3

/**
 * @param {object} [opts]
 * @param {number} [opts.samplesPerRule]
 * @returns {object} a trace sink — attach as `ctx.trace`, or leave it off entirely
 */
export function createTrace ({ samplesPerRule = SAMPLES_PER_RULE } = {}) {
  /** @type {Map<string, {evaluated: number, fired: number}>} run-scope counters */
  const run = new Map()
  /** @type {Map<string, {evaluated: number, fired: number}>} battle-scope counters */
  const battle = new Map()
  /** @type {Map<string, Array>} the worked evaluations behind a badge */
  const samples = new Map()

  const bump = (map, key, fired) => {
    let c = map.get(key)
    if (!c) map.set(key, (c = { evaluated: 0, fired: 0 }))
    c.evaluated++
    if (fired) c.fired++
  }

  const T = {
    /** Called before each battle, so "in the last battle" means what it says. */
    beginBattle () {
      battle.clear()
      samples.clear()
      return T
    },

    /** Called at the start of a run, so "in the last run" means what it says. */
    beginRun () {
      run.clear()
      battle.clear()
      samples.clear()
      return T
    },

    /**
     * Whether this evaluation is worth the cost of working out its sub-expression values. Checked
     * before the expression is evaluated, so a `false` here costs one Map lookup and nothing else.
     */
    wantsSample: (editor, index) => (samples.get(`${editor}:${index}`)?.length ?? 0) < samplesPerRule,

    /**
     * @param {string} editor  'recruit' | 'ability' | 'targeting' | 'route'
     * @param {number} index   which rule, by its position in the ordered list
     * @param {boolean} fired
     * @param {Array|null} steps  sub-expression values from `forms.evalTraced`, when sampled
     */
    record (editor, index, fired, steps = null) {
      const key = `${editor}:${index}`
      bump(run, key, fired)
      bump(battle, key, fired)
      if (!steps) return
      const list = samples.get(key) ?? []
      list.push({ fired, steps })
      samples.set(key, list)
    },

    /** A decision that is not a rule — which target won, which ability was reached for. */
    note (editor, index, detail) {
      const key = `${editor}:${index}`
      const list = samples.get(key) ?? []
      if (list.length < samplesPerRule) list.push({ fired: true, steps: null, detail })
      samples.set(key, list)
    },

    /** Plain JSON for the badge and the popover. Safe to call every frame; it copies little. */
    snapshot () {
      const out = { run: {}, battle: {}, samples: {} }
      for (const [k, v] of run) out.run[k] = { ...v }
      for (const [k, v] of battle) out.battle[k] = { ...v }
      for (const [k, v] of samples) out.samples[k] = v.slice(-samplesPerRule)
      return out
    },

    /** The two numbers a badge shows. */
    countsFor: (editor, index) => ({
      run: run.get(`${editor}:${index}`) ?? { evaluated: 0, fired: 0 },
      battle: battle.get(`${editor}:${index}`) ?? { evaluated: 0, fired: 0 }
    }),

    samplesFor: (editor, index) => (samples.get(`${editor}:${index}`) ?? []).slice(-samplesPerRule)
  }

  return T
}

/**
 * Render one worked evaluation as the lines §4.1 promises — `kinCount(Drake) → 4`, so a `0` badge
 * becomes a sentence. Lives here rather than in `ui/` because it is a fact about the trace format,
 * and `tools/sim.js` will want to print it with no DOM in sight.
 *
 * @returns {string[]}
 */
export function explain (sample) {
  if (!sample?.steps) return sample?.detail ? [sample.detail] : []
  return sample.steps.map((s) => `${s.text} → ${format(s.value)}`)
}

function format (v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3)
  if (Array.isArray(v)) return `[${v.length}]`
  if (typeof v === 'object') return v.defId ?? '{…}'
  return String(v)
}
