/**
 * Vercel adapter for the session-introspection endpoint.
 *
 * This is a thin platform-specific shim — the actual logic lives in
 * `server/handlers.ts` and is shared with the standalone Node server
 * (`npm start`) and the Vite dev plugin. Same handler, three hosts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSession } from '../../server/handlers'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleSession(req, res)
}
