/**
 * Shared types for the Self-Healing Eval feature.
 *
 * Wire shape of every JSON response from /api/self-healing-eval/* is
 * derived from these types. Keep them stable — they end up in stored
 * report files and the Copilot prompt.
 */

export type EvalLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type EvalMode = 'smoke' | 'developer' | 'full'
export type Verdict = 'pass' | 'partial' | 'fail'
export type RunStatus = 'idle' | 'running' | 'pass' | 'partial' | 'fail' | 'error'

export type RootCause =
  | 'missing-docs'
  | 'weak-docs-memory-pack'
  | 'retrieval-miss'
  | 'retrieved-context-ignored'
  | 'eval-judge-context-blindness'
  | 'demo-agent-prompt'
  | 'hallucinated-code-or-api'
  | 'unsupported-npm-sdk-claim'
  | 'weak-topic-drift-handling'
  | 'false-premise-not-corrected'
  | 'webhook-config'
  | 'statewave-api-health'
  | 'admin-diagnostics'
  | 'unclear-user-question'
  | 'unknown'

export interface EvalQuestion {
  id: string
  level: EvalLevel
  category: string
  question: string
  expected_behavior: string
  must_include: string[]
  must_not_claim: string[]
  requires_code: boolean
  requires_docs_grounding: boolean
  topic_drift: boolean
  false_premise: boolean
  follow_up_of?: string
  weight: number
}

export interface QuestionFilter {
  mode: EvalMode
  max_level?: EvalLevel
  max_questions?: number
  include_code?: boolean
  include_topic_drift?: boolean
}

export interface JudgeEvaluation {
  correctness_score: number
  grounding_score: number
  completeness_score: number
  clarity_score: number
  safety_score: number
  overall_score: number
  verdict: Verdict
  reason: string
  missing_points: string[]
  hallucination_risks: string[]
  recommended_fix: string
  likely_root_cause: RootCause[]
}

export interface RetrievedContextItem {
  /** Raw memory/episode text, redacted + capped before storage. */
  text: string
  /** Relevance score if upstream provided one (0..1). Optional. */
  score?: number
  /** Doc path if the retrieved item was sourced from a docs file. */
  source_path?: string
  memory_id?: string
  episode_id?: string
  /** Section/chunk this came from (e.g. "facts", "procedures", "episodes"). */
  kind?: string
  metadata?: Record<string, unknown>
}

export interface RetrievedContextResult {
  status: 'pass' | 'fail' | 'not_configured' | 'skipped'
  subject_id: string
  query: string
  results: RetrievedContextItem[]
  /** Set when status === 'fail' so the report can show why. */
  error?: string
  /** True when retrieval returned items but none looked relevant. */
  no_relevant_results?: boolean
}

export interface ConversationTurn {
  turn_id: string
  question_id: string
  level: EvalLevel
  category: string
  question: string
  answer: string
  follow_up_of?: string
  metadata: {
    requires_code: boolean
    requires_docs_grounding: boolean
    topic_drift: boolean
    false_premise: boolean
    /** Carried over from the question bank so the markdown report can
     *  show the EXACT substring check that flipped (or didn't flip)
     *  the judge's classification. Empty when the question has no
     *  hard-coded must_include terms (e.g. some L5/L9 questions). */
    must_include?: string[]
  }
  /**
   * When the question requires docs grounding, the runner probes
   * Statewave's /v1/context endpoint with the question text against
   * the configured docs subject and attaches the result here. The
   * judge sees this too — letting it distinguish a real `missing-docs`
   * (retrieval found nothing relevant) from `retrieval-miss` (docs
   * exist but the query missed) from `retrieved-context-ignored`
   * (relevant docs retrieved but the agent didn't surface them).
   */
  retrieved_context?: RetrievedContextResult
  evaluation: JudgeEvaluation
}

export interface LevelSummary {
  name: string
  turns_total: number
  passes: number
  partials: number
  fails: number
  average_score: number
}

export interface CategorySummary {
  turns_total: number
  passes: number
  partials: number
  fails: number
  average_score: number
}

export interface RootCauseSummary {
  count: number
  example_turn_ids: string[]
}

export interface ReportRecommendation {
  priority: 'high' | 'medium' | 'low'
  area:
    | 'docs-memory-pack'
    | 'demo-agent-prompt'
    | 'retrieval'
    | 'webhook'
    | 'admin'
    | 'core-api'
    | 'tests'
  problem: string
  recommended_change: string
  acceptance_criteria: string[]
}

export interface AgentPromptOverrideMetadata {
  /** True when the operator supplied an eval-only override for this run. */
  used: boolean
  /**
   *   "not_used"          — no override supplied
   *   "sent"              — override sent to the demo agent (transport ok)
   *   "sent_unconfirmed"  — sent, but the agent did NOT return a confirmation marker
   *   "confirmed"         — agent echoed system_prompt_override_applied=true
   */
  delivery: 'not_used' | 'sent' | 'sent_unconfirmed' | 'confirmed'
  /** Length of the redacted override that left the admin process. */
  length: number
  /**
   * SHA-256 of the redacted override. Used to identify the same prompt
   * across runs without persisting its full text. Empty when not used.
   */
  hash: string
  /** First N redacted characters — for the report preview. Capped. */
  preview: string
}

export interface EvalReportConfig {
  statewave_api_url: string
  llm_provider: string
  llm_model: string
  demo_agent_configured: boolean
  webhook_configured: boolean
  /**
   * Eval-only agent system prompt override. Never includes the full
   * raw text — redacted preview + hash so the operator can audit
   * what was attempted without leaking secrets back into a stored
   * report or the Copilot prompt.
   */
  agent_prompt_override: AgentPromptOverrideMetadata
}

export interface HealthResult {
  status: 'pass' | 'fail'
  details: Record<string, unknown>
}

export interface DemoJobResult {
  status: 'pass' | 'partial' | 'fail'
  details: Record<string, unknown>
}

export interface WebhookResult {
  status: 'pass' | 'partial' | 'fail' | 'not_configured'
  trigger_attempted: boolean
  delivery_observed: boolean
  details: Record<string, unknown>
  recommended_fix: string
}

/**
 * Side-by-side comparison of the current run vs an earlier baseline run.
 * Rendered into the report when EvalRunOptions.baseline_run_id is set
 * and the baseline can be loaded from storage.
 */
export interface RootCauseDelta {
  before: number
  after: number
  delta: number
}

export interface LevelDelta {
  before_avg: number
  after_avg: number
  delta: number
}

export interface ComparisonResult {
  baseline_run_id: string
  candidate_run_id: string
  baseline_score: number
  candidate_score: number
  score_delta: number
  pass_delta: number
  partial_delta: number
  fail_delta: number
  root_cause_delta: Record<string, RootCauseDelta>
  level_delta: Record<string, LevelDelta>
  /** turn_id values that improved meaningfully vs baseline. */
  improved_turns: string[]
  /** turn_id values that regressed vs baseline. */
  regressed_turns: string[]
  /** turns that stayed in fail/partial across both runs. */
  unchanged_failed_turns: string[]
}

export interface EvalReport {
  run_id: string
  started_at: string
  finished_at: string | null
  status: RunStatus
  mode: EvalMode
  max_level: EvalLevel
  config: EvalReportConfig
  health: HealthResult
  webhook: WebhookResult
  demo_job: DemoJobResult
  conversation: ConversationTurn[]
  summary: {
    turns_total: number
    passes: number
    partials: number
    fails: number
    overall_score: number
  }
  summary_by_level: Record<string, LevelSummary>
  summary_by_category: Record<string, CategorySummary>
  summary_by_root_cause: Record<string, RootCauseSummary>
  recommendations: ReportRecommendation[]
  copilot_prompt: string
  /** Progress for in-flight runs. Frozen once finished_at is set. */
  progress: {
    completed: number
    total: number
    current_question_id: string | null
  }
  /** Top-level error if the whole run could not start (e.g. LLM not configured). */
  error: string | null
  /** Side-by-side comparison vs an earlier baseline run, when requested. */
  comparison?: ComparisonResult
}

export interface EvalAvailability {
  available: boolean
  enabled: boolean
  llm_configured: boolean
  demo_agent_configured: boolean
  webhook_configured: boolean
  reasons: string[]
}

export interface EvalStatus {
  availability: EvalAvailability
  is_running: boolean
  current_run_id: string | null
  /** Compact summary of the most recent finished run, or null. */
  latest: {
    run_id: string
    status: RunStatus
    finished_at: string | null
    overall_score: number
    mode: EvalMode
  } | null
  /** Live progress when is_running=true. */
  progress: { completed: number; total: number; current_question_id: string | null } | null
  config_summary: {
    statewave_api_url_set: boolean
    llm_provider: string | null
    llm_model: string | null
    demo_agent_url_set: boolean
    webhook_url_set: boolean
    storage_path_set: boolean
  }
}

export interface EvalRunOptions {
  mode?: EvalMode
  max_level?: EvalLevel
  max_questions?: number
  include_code?: boolean
  include_topic_drift?: boolean
  /**
   * If set, the runner uses these questions verbatim (after mode/level
   * safety filtering and schema validation) instead of selecting from
   * the static built-in bank. Sourced from the question generator —
   * see questionGenerator.ts.
   */
  override_questions?: EvalQuestion[]
  /**
   * Subject the demo agent should answer FROM during the conversation
   * phase. When unset, the eval uses a hardcoded demo subject so it
   * can't accidentally pollute a real customer subject. Smoke probes
   * (health/job/webhook) ALWAYS use their own dedicated demo subject
   * regardless — see runSmoke().
   */
  subject_id?: string
  /**
   * Eval-only override for the demo agent's system prompt. Forwarded
   * to the agent in the request body. NEVER persisted as a production
   * prompt in any repo — the override lives only for this run. Length
   * is capped server-side and the body is run through the secret
   * redactor before storing any preview.
   */
  system_prompt_override?: string
  /**
   * If set, the runner pulls the report for this run id and computes
   * a comparison block (score / pass / per-root-cause / per-level /
   * improved-vs-regressed turns). Surfaces in both the JSON report
   * and the markdown render. See comparison.ts.
   */
  baseline_run_id?: string
}

export interface QuestionGenerationRequest {
  topic: string
  grounding: string
  mode: EvalMode
  max_level?: EvalLevel
}

export interface QuestionGenerationResult {
  cache_key: string
  questions: EvalQuestion[]
  warnings: string[]
}
