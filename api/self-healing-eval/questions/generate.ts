/**
 * Vercel adapter for the question-bank generator endpoint.
 *
 * Operator pastes a topic + grounding text; the admin server forwards
 * to the configured ADMIN_EVAL_LLM_* and returns a validated EvalQuestion[]
 * cached in-memory by hash. Auth lives in the shared handler.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleEvalQuestionsGenerate } from '../../../server/handlers.js'

export default async function (req: IncomingMessage, res: ServerResponse) {
  return handleEvalQuestionsGenerate(req, res)
}
