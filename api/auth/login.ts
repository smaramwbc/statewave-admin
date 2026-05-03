/**
 * Vercel adapter — see `api/auth/session.ts` for the pattern.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleLogin } from '../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleLogin(req, res)
}
