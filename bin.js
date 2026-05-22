#!/usr/bin/env node
import { createServer } from 'node:http'
import { stat, readFile, watch } from 'node:fs/promises'
import { join, extname, relative, sep } from 'node:path'

function isInsideRoot(root, p) {
  const rel = relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep))
}

function injectReloadScript(reloadScript, html) {
  return html.includes('</body>')
    ? html.replace('</body>', reloadScript + '</body>')
    : html + reloadScript
}

async function resolveFile(requested) {
  const s = await stat(requested)
  return s.isDirectory() ? join(requested, 'index.html') : requested
}

async function serveFile(res, filePath, mime, reloadScript) {
  const data = await readFile(filePath)
  const ext = extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' })
  res.end(ext === '.html' ? injectReloadScript(reloadScript, data.toString()) : data)
}

function createBroadcaster() {
  const clients = new Set()
  return {
    attach: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      })
      clients.add(res)
      req.on('close', () => clients.delete(res))
      res.on('error', () => clients.delete(res))
    },
    notify: () => {
      for (const client of clients) {
        try {
          client.write('data: reload\n\n')
        } catch {
          clients.delete(client)
        }
      }
    },
    closeAll: () => {
      for (const c of clients) c.end()
      clients.clear()
    },
  }
}

function debounced(fn, ms) {
  const state = { timer: null }
  return () => {
    clearTimeout(state.timer)
    state.timer = setTimeout(fn, ms)
  }
}

async function main() {
  const PORT = Number(process.argv[2]) || 3000
  const ROOT = process.cwd()
  const DEBOUNCE_MS = 50
  const RELOAD_PATH = '/__lrs'
  const RELOAD_SCRIPT = `<script>new EventSource('${RELOAD_PATH}').onmessage=()=>location.reload()</script>`

  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.gif': 'image/gif',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  }

  const broadcaster = createBroadcaster()

  const handle = async (req, res) => {
    if (req.url === RELOAD_PATH) {
      broadcaster.attach(req, res)
      return
    }

    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0])
      const requested = join(ROOT, urlPath)

      if (!isInsideRoot(ROOT, requested)) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }

      const filePath = await resolveFile(requested)
      await serveFile(res, filePath, MIME, RELOAD_SCRIPT)
    } catch (err) {
      if (err instanceof URIError) {
        res.writeHead(400)
        res.end('Bad Request')
      } else if (err.code === 'ENOENT') {
        res.writeHead(404)
        res.end('Not Found')
      } else if (err.code === 'EACCES') {
        res.writeHead(403)
        res.end('Forbidden')
      } else {
        console.error('lrs:', err)
        res.writeHead(500)
        res.end('Internal Server Error')
      }
    }
  }

  const server = createServer(handle)
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`lrs: port ${PORT} is already in use`)
    } else {
      console.error('lrs: server error', err)
    }
    process.exit(1)
  })
  server.listen(PORT, () => {
    console.log(`lrs: http://localhost:${PORT}`)
    console.log(`lrs: serving ${ROOT}`)
  })

  const controller = new AbortController()
  const shutdown = () => {
    controller.abort()
    broadcaster.closeAll()
    server.close()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  const scheduleReload = debounced(broadcaster.notify, DEBOUNCE_MS)
  try {
    for await (const _ of watch(ROOT, { recursive: true, signal: controller.signal })) {
      scheduleReload()
    }
  } catch (err) {
    if (err.name !== 'AbortError') console.error('lrs: watch error', err)
  }
}

main()
