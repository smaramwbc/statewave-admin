/**
 * Public surface for the Self-Healing Eval module.
 *
 * Imported by `server/handlers.ts` and the Vercel adapters under
 * `api/self-healing-eval/`. Keep this thin — handler-level concerns
 * (auth, JSON shape, redaction) live one layer up.
 */
export { getEvalConfig, getAvailability } from './config.js'
export {
  startEvalRun,
  getEvalStatus,
  _resetEvalRunnerForTests,
} from './runner.js'
export { getById, getLatest, _resetEvalStorageForTests } from './storage.js'
export { renderMarkdownReport, buildCopilotPrompt } from './reportFormat.js'
export {
  generateQuestionBank,
  validateGeneratedBank,
  applyOverrideSafetyFilter,
  getCachedBank,
  QuestionGenerationError,
  GROUNDING_MAX_BYTES,
  _resetQuestionGeneratorForTests,
} from './questionGenerator.js'
export type {
  EvalAvailability,
  EvalLevel,
  EvalMode,
  EvalReport,
  EvalRunOptions,
  EvalStatus,
  Verdict,
  RootCause,
} from './types.js'
