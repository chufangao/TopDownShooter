// The offline tools' command line: `arg(name, def)` the value after `--name` (or `def`), `has(name)` whether `--name` is
// given, `list(name)` a comma-separated value as an array, `num(name)` a number or undefined.
export const arg = (name, def = null) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
}
export const has = (name) => process.argv.includes('--' + name)
export const list = (name) => (arg(name, '') || '').split(',').filter(Boolean)
export const num = (name) => (arg(name, null) === null ? undefined : Number(arg(name)))
// Whether this module is the one node was started with (and not a worker thread of it).
export const isMain = (url) => typeof process !== 'undefined' && process.argv[1] === decodeURIComponent(new URL(url).pathname)
