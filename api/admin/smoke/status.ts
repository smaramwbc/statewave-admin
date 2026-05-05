/**
 * Vercel adapter for the smoke-status endpoint.
 *
 * Thin shim — auth + smoke read live in `server/handlers.ts` so the
 * standalone Node server, the Vite dev plugin, and Vercel all run the
 * same code path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSmokeStatus } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleSmokeStatus(req, res)
}
