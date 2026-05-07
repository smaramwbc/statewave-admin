/**
 * Optional Vercel adapter for statewave-admin.
 *
 * The single Vercel-specific file in the website tree. Every `/api/*`
 * request is rewritten to this function by `vercel.json` and forwarded
 * to the same vendor-neutral `dispatch()` the standalone Node server
 * (`server/index.ts`) and the Vite dev plugin (`server/vite-plugin.ts`)
 * already use. Adding a new endpoint requires only an entry in
 * `server/handlers.ts` — no edit here, no new shim file.
 *
 * The adapter is Node-shape (`(req: IncomingMessage, res: ServerResponse)`)
 * because the underlying handlers are Node-shape. That keeps Vercel on
 * its default Node serverless runtime — no `runtime: 'edge'` directive
 * needed, and self-hosters never load this file.
 *
 * Why a `vercel.json` rewrite instead of a `[...slug].ts` filename
 * catch-all: in non-Next.js Vercel projects, the filesystem router
 * treats `[...slug]` as a single dynamic segment, not a multi-segment
 * glob. `/api/foo` matches but `/api/foo/bar` 404s. A `vercel.json`
 * rewrite (`/api/(.*) → /api/dispatch`) reliably routes every depth.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dispatch } from '../server/handlers.js'

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // The vercel.json rewrite captures the original `/api/<...>` path in
  // the `_path` query param. After the rewrite, `req.url` reads as
  // `/api/dispatch?_path=<...>` — `dispatch()` keys off `req.url`, so
  // we restore the original path on the request before calling it.
  // Outside Vercel (standalone server, Vite plugin) `_path` is absent
  // and req.url already carries the real path, so this branch is a no-op.
  //
  // The capture in vercel.json is named `:slug*` (not `:path*`) on
  // purpose: Vercel auto-injects every named capture as a query param
  // of the same name onto the rewritten request, and that auto-inject
  // *replaces* any same-named query the client sent. With `:path*` the
  // injected `path=<capture>` clobbered the client's `?path=...` (the
  // proxy's upstream-path argument), making `/api/proxy?path=/admin/X`
  // unreachable — proxy got `path=proxy` and 400'd as `invalid_path`.
  // Naming the capture `:slug*` keeps the auto-inject at `slug=...`,
  // which we then strip below; the client's `?path=...` survives.
  if (req.url) {
    try {
      const u = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`)
      const originalPath = u.searchParams.get('_path')
      if (originalPath) {
        u.searchParams.delete('_path')
        u.searchParams.delete('slug')
        const qs = u.search ? u.search : ''
        req.url = `/api/${originalPath}${qs}`
      }
    } catch {
      // Malformed req.url — let dispatch render its own 4xx.
    }
  }

  const handled = await dispatch(req, res)
  if (!handled && !res.writableEnded) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'not_found', path: req.url ?? '' }))
  }
}
