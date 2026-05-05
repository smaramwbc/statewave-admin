/**
 * Vercel adapter for the latest Self-Healing Eval report.
 *
 * Supports `?format=markdown` for the rendered version. Default is
 * the full JSON report. Both run through the redaction layer first.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalReportLatest } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleEvalReportLatest(req, res)
}
