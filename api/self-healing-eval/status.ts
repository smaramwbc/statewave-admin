/**
 * Vercel adapter for the Self-Healing Eval status endpoint.
 *
 * Read-only — returns availability flags + latest run summary. Auth is
 * enforced inside `handleEvalStatus` so this shim stays platform-only.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalStatus } from '../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleEvalStatus(req, res)
}
