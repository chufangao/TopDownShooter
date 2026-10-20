// A fitted forest's trees in play: compiled to typed arrays once (compileTrees), their leaves' mean read for raw inputs
// (treesMean). The forests out of battle (outforest.js) and the fitter (forestfit.js) read them alike.
//   a forest's trees  { size (each tree's node count), feat (a node's input index; −1 a leaf), thr (x ≤ thr: the next
//                     node), right (an inner node's right child, nodes ahead), value (a leaf's) }, preorder, tree after tree

// The targets a forest is fitted to: an option's value less its decision's mean (`mean`), or less today's pick's (`today`).
export const TARGETS = Object.freeze(['mean', 'today'])

// A number as the rows write it: rounded to 6 decimals.
export const r6 = (x) => Math.round(x * 1e6) / 1e6

// The trees of a configuration in typed arrays for play, each split's input `at[feat]` and each right child its index.
// → { feat, thr, right, val, roots }
export function compileTrees (model, at) {
  const n = model.feat.length
  const feat = new Int32Array(n)
  const thr = new Float64Array(n)
  const right = new Int32Array(n)
  const val = new Float64Array(n)
  const roots = new Int32Array(model.size.length)
  let k = 0
  let i = 0
  let j = 0
  for (let t = 0; t < model.size.length; t++) {
    roots[t] = k
    const end = k + model.size[t]
    for (; k < end; k++) {
      const f = model.feat[k]
      if (f < 0) {
        feat[k] = -1
        val[k] = model.value[j++]
        continue
      }
      feat[k] = at[f]
      thr[k] = model.thr[i]
      right[k] = k + model.right[i++]
      if (!(right[k] > k + 1 && right[k] < end)) throw new Error(`forest: tree ${t}'s node ${k - roots[t]} points outside it`)
    }
  }
  return { feat, thr, right, val, roots }
}

// The mean of the trees' leaves for raw inputs `x` (the layout the trees were compiled for: compileTrees).
export function treesMean (rt, x) {
  const { feat, thr, right, val, roots } = rt
  let s = 0
  for (let t = 0; t < roots.length; t++) {
    let k = roots[t]
    for (let f = feat[k]; f >= 0; f = feat[k]) k = x[f] <= thr[k] ? k + 1 : right[k]
    s += val[k]
  }
  return roots.length ? s / roots.length : 0
}
