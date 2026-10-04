// Twelve lines of DOM helper, and deliberately not a framework.
//
// §8 puts the Doctrine editors in plain DOM: they are forms over a JSON tree, they render a few
// dozen nodes, and they update when the player changes something. A framework here would be a
// dependency, a build step and a second mental model for the sake of a `map()`.

export function el (tag, props = {}, children = []) {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue
    if (k === 'class') node.className = v
    else if (k === 'text') node.textContent = v
    else if (k === 'html') node.innerHTML = v
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'dataset') Object.assign(node.dataset, v)
    else node.setAttribute(k, v === true ? '' : String(v))
  }
  for (const child of [children].flat(3)) {
    if (child === null || child === undefined || child === false) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** A `<select>` built from `{value, label, title, group}` rows. The whole editor is made of these. */
export function select (options, value, onChange, { title = '', className = 'chip' } = {}) {
  const node = el('select', { class: className, title, onchange: (e) => onChange(e.target.value) })
  const groups = new Map()
  for (const opt of options) {
    const key = opt.group ?? ''
    let parent = node
    if (key) {
      if (!groups.has(key)) groups.set(key, node.appendChild(el('optgroup', { label: key })))
      parent = groups.get(key)
    }
    parent.appendChild(el('option', { value: opt.value, text: opt.label, title: opt.title ?? '', selected: opt.value === value }))
  }
  // A stored value the current content no longer offers (a mod was removed) shows as itself rather
  // than silently becoming whatever happens to be first in the list.
  if (!options.some((o) => o.value === value)) {
    node.insertBefore(el('option', { value, text: `${value} (missing)`, selected: true }), node.firstChild)
  }
  node.value = value
  return node
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild) }
