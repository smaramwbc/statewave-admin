/**
 * Vercel adapter for the grounding suggester.
 *
 * Operator picks a subject in the UI; the admin server pulls the
 * subject's compiled memories from the connected Statewave backend,
 * redacts + caps them, and asks the LLM to produce a `{ topic, grounding }`
 * pair the operator can drop into the question generator.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalGroundingSuggest } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleEvalGroundingSuggest(req, res)
}
