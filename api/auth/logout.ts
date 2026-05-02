/**
 * Vercel adapter — see `api/auth/session.ts` for the pattern.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleLogout } from '../../server/handlers'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleLogout(req, res)
}
