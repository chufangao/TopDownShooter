// Serves the game for the browser, offline and with no build step:  node serve.js [port]
// It listens on every interface, so a phone or tablet on the same Wi-Fi can open one of the LAN URLs it prints.
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const root = new URL('.', import.meta.url).pathname
const port = Number(process.argv[2] ?? 5173)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }

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
}).listen(port, () => {
  console.log(`RETINUE at http://localhost:${port}`)
  // This machine's own addresses on the local network (IPv4, not loopback).
  const lan = Object.values(networkInterfaces()).flat().filter((a) => a && !a.internal && (a.family === 'IPv4' || a.family === 4))
  for (const a of lan) console.log(`  on your network: http://${a.address}:${port}`)
})
