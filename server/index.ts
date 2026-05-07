/**
 * Standalone Node HTTP server for statewave-admin.
 *
 * Vendor-neutral: zero npm dependencies (only `node:*` built-ins). Runs on
 * any Node runtime. Deploy with Docker, behind nginx/Caddy/Traefik/HAProxy/
 * an ALB, on Kubernetes, on a bare VPS, on any PaaS that runs Node — same
 * binary, no platform-specific config.
 *
 *   PORT                 default 8080
 *   HOST                 default 0.0.0.0
 *   ADMIN_STATIC_DIR     default ./dist  (the built Vite output)
 *
 * Plus the auth/proxy env vars documented in .env.example.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, resolve, extname } from 'node:path'
import { URL } from 'node:url'
import { dispatch } from './handlers.js'

// PORT=0 (or "0") asks the OS for a free port. We can't use the
// `|| 8080` fallback here because `Number.parseInt('0') || 8080` reads
// 0 as falsy — the explicit nullish check below preserves the deploy
// default of 8080 while letting the Tauri sidecar pass `0` for an
// OS-assigned port.
const RAW_PORT = process.env.PORT
const PORT = RAW_PORT === undefined || RAW_PORT === ''
  ? 8080
  : Number.parseInt(RAW_PORT, 10)
const HOST = process.env.HOST ?? '0.0.0.0'
const STATIC_DIR = resolve(process.env.ADMIN_STATIC_DIR ?? './dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

/**
 * Decide cache-control headers for a static asset.
 *
 *   - sw.js, manifest, offline.html, root index.html: never cache. The
 *     service worker file in particular MUST always be served fresh —
 *     a cached SW means users get stuck on an old build and we lose the
 *     ability to ship updates.
 *   - Vite content-hashed assets under /assets/*: cache forever; the
 *     hash in the filename invalidates them naturally on a new build.
 *   - Everything else: short max-age + must-revalidate so a deploy
 *     reaches users quickly without flooding the origin.
 */
function cacheControlFor(pathname: string): string {
  if (
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/offline.html' ||
    pathname === '/' ||
    pathname.endsWith('/index.html')
  ) {
    return 'no-cache, no-store, must-revalidate'
  }
  if (pathname.startsWith('/assets/')) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=300, must-revalidate'
}

async function serveStatic(_req: IncomingMessage, res: ServerResponse, pathname: string) {
  const safe = normalize(pathname).replace(/^(\.\.[\\/])+/, '/')
  let filePath = join(STATIC_DIR, safe)
  if (!filePath.startsWith(STATIC_DIR)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'invalid_path' }))
    return
  }
  try {
    let st = await stat(filePath)
    if (st.isDirectory()) {
      filePath = join(filePath, 'index.html')
      st = await stat(filePath)
    }
    if (!st.isFile()) throw new Error('not_a_file')
    const ext = extname(filePath).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', cacheControlFor(pathname))
    // The service worker is restricted to its own origin's scope. Set
    // the explicit Service-Worker-Allowed header anyway so downstream
    // caches understand its scope contract.
    if (pathname === '/sw.js') {
      res.setHeader('Service-Worker-Allowed', '/')
    }
    res.end(await readFile(filePath))
  } catch {
    try {
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
      res.end(await readFile(join(STATIC_DIR, 'index.html')))
    } catch {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'not_found' }))
    }
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    if (url.pathname.startsWith('/api/')) {
      const handled = await dispatch(req, res)
      if (!handled) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify({ error: 'not_found' }))
      }
      return
    }
    const method = (req.method ?? 'GET').toUpperCase()
    if (method === 'GET' || method === 'HEAD') {
      return serveStatic(req, res, url.pathname)
    }
    res.statusCode = 405
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'method_not_allowed' }))
  } catch {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'internal_error' }))
  }
})

server.listen(PORT, HOST, () => {
  // Use the actual bound port — when PORT=0 the OS picks one and the
  // requested PORT is 0, not the real port. The `[sidecar-ready] port=N`
  // line is the contract the Tauri shell parses on stdout to learn where
  // to point the WebView.
  const addr = server.address()
  const boundPort = typeof addr === 'object' && addr ? addr.port : PORT
  console.info(`[statewave-admin] listening on http://${HOST}:${boundPort} (static: ${STATIC_DIR})`)
  console.info(`[sidecar-ready] port=${boundPort}`)
})
