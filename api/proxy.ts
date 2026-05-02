/**
 * Vercel adapter for the auth-gated admin proxy.
 *
 * Thin shim — auth check, allowlist, and upstream forwarding all live in
 * `server/handlers.ts` (which delegates to `server/auth.ts` + `server/proxy.ts`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleProxy } from '../server/handlers'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleProxy(req, res)
}
