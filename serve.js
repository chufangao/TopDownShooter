// Serves the game for the browser, offline and with no build step:  node serve.js [port]
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = new URL('.', import.meta.url).pathname
const port = Number(process.argv[2] ?? 5173)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' }

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)) // absolute, so '..' cannot climb out
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, () => console.log(`RETINUE at http://localhost:${port}`))
