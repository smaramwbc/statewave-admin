/**
 * Vercel adapter for a single Self-Healing Eval report by run id.
 *
 * The runId comes from the file-based dynamic route. We forward to the
 * shared handler which re-extracts it from req.url so the same code
 * path serves the standalone Node server too.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalReportById, ROUTES } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname
  const runId = path.startsWith(ROUTES.evalReportPrefix)
    ? decodeURIComponent(path.slice(ROUTES.evalReportPrefix.length))
    : ''
  if (!runId || runId === 'latest') {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'invalid_run_id' }))
    return
  }
  return handleEvalReportById(req, res, runId)
}
