/**
 * Vercel adapter for the smoke-run endpoint.
 *
 * Thin shim — privileged backend writes are gated by `handleSmokeRun` in
 * `server/handlers.ts`, which checks the same session/gateway auth as
 * `/api/proxy` before invoking the smoke flow.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSmokeRun } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleSmokeRun(req, res)
}
