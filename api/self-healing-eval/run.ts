/**
 * Vercel adapter for kicking off a Self-Healing Eval run.
 *
 * The handler returns 202 with a run_id and exits — the actual run
 * continues in the background. Clients poll /status or /report/latest.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalRun } from '../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleEvalRun(req, res)
}
