/**
 * Optional Vercel adapter for statewave-admin.
 *
 * The single Vercel-specific file in the website tree. Every `/api/*`
 * request lands here (catch-all glob) and is forwarded to the same
 * vendor-neutral `dispatch()` the standalone Node server
 * (`server/index.ts`) and the Vite dev plugin (`server/vite-plugin.ts`)
 * already use. Adding a new endpoint requires only an entry in
 * `server/handlers.ts` — no edit here, no new shim file.
 *
 * The adapter is Node-shape (`(req: IncomingMessage, res: ServerResponse)`)
 * because the underlying handlers are Node-shape. That keeps Vercel on
 * its default Node serverless runtime — no `runtime: 'edge'` directive
 * needed, and self-hosters never load this file.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dispatch } from '../server/handlers.js'

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const handled = await dispatch(req, res)
  if (!handled && !res.writableEnded) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'not_found', path: req.url ?? '' }))
  }
}
