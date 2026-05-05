/**
 * Self-Healing Eval configuration.
 *
 * Reads only from process.env. Never sees a VITE_* prefix — secrets stay
 * server-side. The exported shape feeds both `getStatus` (which reports
 * which fields are configured, never the values) and the runner (which
 * uses the values to talk to the LLM judge / demo agent).
 */
import type { EvalAvailability } from './types.js'

/**
 * Wire-shape selector for the demo agent's request body.
 *   "default"        — the eval's native shape
 *   "statewave-web"  — adapter for the existing /api/widget-chat endpoint
 *                      in statewave-web. Lets operators point the eval
 *                      at their already-running web app for a quick
 *                      local end-to-end test, without touching that repo.
 */
export type AgentBodyFormat = 'default' | 'statewave-web'

export interface EvalConfig {
  enabled: boolean
  llm: {
    provider: 'openai' | 'anthropic' | 'openai-compatible' | null
    model: string | null
    apiKey: string | null
    baseUrl: string | null
  }
  demoAgent: {
    url: string | null
    apiKey: string | null
    bodyFormat: AgentBodyFormat
    /** Used only when bodyFormat === "statewave-web" — picks the web persona. */
    persona: string
  }
  webhookConfigured: boolean
  storagePath: string | null
  statewaveApiUrl: string | null
  statewaveApiKey: string | null
  /**
   * Subject the judge probes via `/v1/context` to ground its
   * classifications. Lets the eval distinguish "docs missing" from
   * "retrieval missed" from "agent ignored retrieved context" — see
   * contextProbe.ts.
   */
  docsSubjectId: string
}

const KNOWN_PROVIDERS = new Set(['openai', 'anthropic', 'openai-compatible'])
const KNOWN_AGENT_BODY_FORMATS = new Set<AgentBodyFormat>(['default', 'statewave-web'])

export function getEvalConfig(env: NodeJS.ProcessEnv = process.env): EvalConfig {
  const provider = env.ADMIN_EVAL_LLM_PROVIDER?.trim().toLowerCase() ?? ''
  const validProvider =
    provider && KNOWN_PROVIDERS.has(provider)
      ? (provider as EvalConfig['llm']['provider'])
      : null
  return {
    enabled: env.ADMIN_SELF_HEALING_EVAL_ENABLED === 'true',
    llm: {
      provider: validProvider,
      model: env.ADMIN_EVAL_LLM_MODEL ? env.ADMIN_EVAL_LLM_MODEL : null,
      apiKey: env.ADMIN_EVAL_LLM_API_KEY ? env.ADMIN_EVAL_LLM_API_KEY : null,
      baseUrl: env.ADMIN_EVAL_LLM_BASE_URL ? env.ADMIN_EVAL_LLM_BASE_URL : null,
    },
    demoAgent: {
      url: env.ADMIN_DEMO_AGENT_URL ? env.ADMIN_DEMO_AGENT_URL : null,
      apiKey: env.ADMIN_DEMO_AGENT_API_KEY ? env.ADMIN_DEMO_AGENT_API_KEY : null,
      bodyFormat: KNOWN_AGENT_BODY_FORMATS.has(
        (env.ADMIN_DEMO_AGENT_BODY_FORMAT ?? '') as AgentBodyFormat,
      )
        ? ((env.ADMIN_DEMO_AGENT_BODY_FORMAT ?? '') as AgentBodyFormat)
        : 'default',
      persona: env.ADMIN_DEMO_AGENT_PERSONA?.trim() || 'statewave-support',
    },
    webhookConfigured: !!env.ADMIN_DEMO_WEBHOOK_URL,
    storagePath: env.ADMIN_EVAL_STORAGE_PATH ? env.ADMIN_EVAL_STORAGE_PATH : null,
    statewaveApiUrl: env.STATEWAVE_API_URL ? env.STATEWAVE_API_URL : null,
    statewaveApiKey: env.STATEWAVE_API_KEY ? env.STATEWAVE_API_KEY : null,
    docsSubjectId:
      env.ADMIN_EVAL_DOCS_SUBJECT_ID?.trim() || 'statewave-support-docs',
  }
}

export function getAvailability(cfg: EvalConfig): EvalAvailability {
  const reasons: string[] = []
  if (!cfg.enabled) {
    reasons.push('Set ADMIN_SELF_HEALING_EVAL_ENABLED=true to enable Self-Healing Eval.')
  }
  if (!cfg.llm.provider) {
    reasons.push('ADMIN_EVAL_LLM_PROVIDER is not set (expected: openai | anthropic | openai-compatible).')
  }
  if (!cfg.llm.model) {
    reasons.push('ADMIN_EVAL_LLM_MODEL is not set.')
  }
  if (!cfg.llm.apiKey) {
    reasons.push('ADMIN_EVAL_LLM_API_KEY is not set.')
  }
  if (!cfg.statewaveApiUrl) {
    reasons.push('STATEWAVE_API_URL is not set on the admin server.')
  }
  if (!cfg.demoAgent.url) {
    reasons.push('ADMIN_DEMO_AGENT_URL is not set — the eval cannot run without a demo agent.')
  }
  const llmConfigured = !!(cfg.llm.provider && cfg.llm.model && cfg.llm.apiKey)
  const demoAgentConfigured = !!cfg.demoAgent.url
  const available = cfg.enabled && llmConfigured && demoAgentConfigured && !!cfg.statewaveApiUrl
  return {
    available,
    enabled: cfg.enabled,
    llm_configured: llmConfigured,
    demo_agent_configured: demoAgentConfigured,
    webhook_configured: cfg.webhookConfigured,
    reasons,
  }
}
