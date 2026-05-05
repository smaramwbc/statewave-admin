/**
 * LLM-driven question generator.
 *
 * Takes a topic + grounding text and asks the configured ADMIN_EVAL_LLM_*
 * to produce a level-aware (L0–L9) question bank that conforms to the
 * EvalQuestion schema. The result is cached in-memory keyed by
 * hash(topic + grounding + mode + max_level) so a regenerate-then-run
 * sequence is reproducible.
 *
 * Three things make this safe for arbitrary subjects:
 *
 *   1. **Grounding cap.** Operator-pasted grounding can be huge or
 *      contain credentials. We hard-cap bytes and run it through the
 *      admin's secret redactor before it ever crosses the network to
 *      the LLM. The redacted string is also what the cache key hashes.
 *   2. **Strict JSON.** OpenAI / Anthropic both support enforced JSON;
 *      we use it. If the model still returns malformed output, the
 *      whole bank is rejected.
 *   3. **Schema validation.** Every question is checked against the
 *      EvalQuestion shape before we accept it. Invalid questions are
 *      dropped (with a warning); if nothing valid remains, the entire
 *      bank is rejected with a structured error.
 */
import { createHash } from 'node:crypto'
import type { EvalConfig } from './config.js'
import type { JudgeFetch } from './llmJudge.js'
import { redactString } from './redact.js'
import { LEVEL_NAMES } from './questionBank.js'
import type {
  EvalLevel,
  EvalMode,
  EvalQuestion,
  QuestionGenerationRequest,
  QuestionGenerationResult,
} from './types.js'

/** Hard cap for the redacted grounding text we forward to the LLM. */
export const GROUNDING_MAX_BYTES = 32_000

const LEVEL_CEILING_BY_MODE: Record<EvalMode, EvalLevel> = {
  smoke: 1,
  developer: 6,
  full: 9,
}

/** Target question count per level when generating. Conservative — total
 *  comes out to roughly the static bank's size for each mode. */
const QUESTIONS_PER_LEVEL = 3

// ─── Cache ────────────────────────────────────────────────────────────────

interface CacheEntry {
  request_hash: string
  topic: string
  mode: EvalMode
  max_level: EvalLevel
  generated_at: string
  questions: EvalQuestion[]
}

const cache = new Map<string, CacheEntry>()

export function _resetQuestionGeneratorForTests(): void {
  cache.clear()
}

export function getCachedBank(cacheKey: string): EvalQuestion[] | null {
  const entry = cache.get(cacheKey)
  return entry ? entry.questions : null
}

function makeCacheKey(
  topic: string,
  groundingForHash: string,
  mode: EvalMode,
  maxLevel: EvalLevel,
): string {
  const h = createHash('sha256')
  h.update('v1\n')
  h.update(topic.trim())
  h.update('\n')
  h.update(groundingForHash)
  h.update('\n')
  h.update(mode)
  h.update('\n')
  h.update(String(maxLevel))
  return h.digest('hex')
}

// ─── Validation ───────────────────────────────────────────────────────────

const VALID_LEVELS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

interface ValidationOutcome {
  valid: EvalQuestion[]
  warnings: string[]
}

/**
 * Validate one LLM-emitted question against the EvalQuestion schema.
 * Returns the cleaned question or a string error reason.
 */
function validateQuestion(raw: unknown, idx: number): EvalQuestion | string {
  if (!raw || typeof raw !== 'object') return `q[${idx}] not an object`
  const o = raw as Record<string, unknown>

  if (typeof o.id !== 'string' || !o.id.trim()) return `q[${idx}] missing id`
  if (typeof o.level !== 'number' || !VALID_LEVELS.has(o.level)) {
    return `q[${idx}] invalid level "${String(o.level)}"`
  }
  if (typeof o.category !== 'string' || !o.category.trim()) {
    return `q[${idx}] missing category`
  }
  if (typeof o.question !== 'string' || !o.question.trim()) {
    return `q[${idx}] missing question`
  }
  if (typeof o.expected_behavior !== 'string') {
    return `q[${idx}] missing expected_behavior`
  }
  if (!isStringArray(o.must_include)) return `q[${idx}] must_include not string[]`
  if (!isStringArray(o.must_not_claim)) return `q[${idx}] must_not_claim not string[]`
  if (typeof o.requires_code !== 'boolean') return `q[${idx}] requires_code not boolean`
  if (typeof o.requires_docs_grounding !== 'boolean') {
    return `q[${idx}] requires_docs_grounding not boolean`
  }
  if (typeof o.topic_drift !== 'boolean') return `q[${idx}] topic_drift not boolean`
  if (typeof o.false_premise !== 'boolean') return `q[${idx}] false_premise not boolean`
  if (typeof o.weight !== 'number' || !Number.isFinite(o.weight) || o.weight <= 0) {
    return `q[${idx}] weight must be a positive number`
  }
  if (o.follow_up_of !== undefined && typeof o.follow_up_of !== 'string') {
    return `q[${idx}] follow_up_of must be a string when present`
  }

  return {
    id: o.id.trim(),
    level: o.level as EvalLevel,
    category: o.category.trim(),
    question: o.question,
    expected_behavior: o.expected_behavior,
    must_include: o.must_include,
    must_not_claim: o.must_not_claim,
    requires_code: o.requires_code,
    requires_docs_grounding: o.requires_docs_grounding,
    topic_drift: o.topic_drift,
    false_premise: o.false_premise,
    weight: o.weight,
    follow_up_of: typeof o.follow_up_of === 'string' ? o.follow_up_of : undefined,
  }
}

export function validateGeneratedBank(parsed: unknown): ValidationOutcome {
  const warnings: string[] = []
  const valid: EvalQuestion[] = []
  const seenIds = new Set<string>()

  // Accept either a bare array or a wrapper object { questions: [...] }
  // — LLMs often wrap arrays in objects when forced into JSON-mode.
  let items: unknown[]
  if (Array.isArray(parsed)) {
    items = parsed
  } else if (parsed && typeof parsed === 'object') {
    const wrapper = parsed as Record<string, unknown>
    if (Array.isArray(wrapper.questions)) {
      items = wrapper.questions
    } else if (Array.isArray(wrapper.bank)) {
      items = wrapper.bank
    } else {
      return { valid: [], warnings: ['LLM response did not contain a "questions" array'] }
    }
  } else {
    return { valid: [], warnings: ['LLM response was not a JSON array or object'] }
  }

  items.forEach((raw, idx) => {
    const out = validateQuestion(raw, idx)
    if (typeof out === 'string') {
      warnings.push(`dropped: ${out}`)
      return
    }
    if (seenIds.has(out.id)) {
      warnings.push(`dropped: q[${idx}] duplicate id "${out.id}"`)
      return
    }
    seenIds.add(out.id)
    valid.push(out)
  })

  // Drop follow-ups whose parent didn't survive validation.
  const finalIds = new Set(valid.map((q) => q.id))
  const settled: EvalQuestion[] = []
  for (const q of valid) {
    if (q.follow_up_of && !finalIds.has(q.follow_up_of)) {
      warnings.push(`dropped: orphan follow-up "${q.id}" (parent missing)`)
      continue
    }
    settled.push(q)
  }

  return { valid: settled, warnings }
}

// ─── LLM call ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You generate evaluation questions for an LLM-graded eval framework.

You are GIVEN a topic and a chunk of grounding text (the canonical source
of truth for that topic). You produce a level-aware question bank that
follows the Statewave Self-Healing Eval ladder:

  L0 — basic identity            (what is X, what are its primitives)
  L1 — comparison                (X vs Y; product differentiation)
  L2 — workflow                  (the normal use flow end-to-end)
  L3 — local setup               (env, services, run-it-yourself)
  L4 — API + integration         (how to call it programmatically)
  L5 — developer usage / code    (npm/install/code; reward honest
                                  uncertainty over invented packages)
  L6 — debugging                 (diagnostic checklists)
  L7 — multi-step implementation (architecture, multi-tenant org)
  L8 — false-premise correction  (incorrect assumptions to push back on)
  L9 — topic-drift / recovery    (off-topic asks; stay scoped)

Output rules:
- Reply with a SINGLE JSON object: { "questions": [ ... ] }
- Each question MUST conform to this schema exactly:
    {
      "id": string (kebab-case, unique within the bank, prefixed by level e.g. "l3-env-vars"),
      "level": integer 0-9,
      "category": string (snake- or kebab-case theme),
      "question": string (the user-facing question to ask the agent),
      "expected_behavior": string (what a correct answer should do, in 1-2 sentences),
      "must_include": string[] (concrete substrings or terms a correct answer is likely to mention; 0-4 items, derived from the GROUNDING),
      "must_not_claim": string[] (concrete wrong claims to flag; 0-3 items, also derived from grounding),
      "requires_code": boolean (true if the question expects code/install/SDK),
      "requires_docs_grounding": boolean (almost always true for L0-L7),
      "topic_drift": boolean (true ONLY for L9),
      "false_premise": boolean (true ONLY for L8 false-premise turns),
      "weight": number > 0 (1 baseline; 2 for L5/L7/L8/L9 high-stakes turns),
      "follow_up_of": string (optional — id of an earlier question this follows; the parent MUST exist in the same bank)
    }

Constraints:
- Generate questions ONLY for levels 0..max_level (inclusive). Do not skip levels.
- Aim for 3 questions per level. Keep them short and specific.
- Derive must_include / must_not_claim from concrete facts in the grounding text.
  Avoid generic phrasings. If the grounding doesn't contain a fact, leave the
  array empty — do NOT invent.
- Question ids must follow the pattern "l<level>-<short-kebab-slug>".
- Do NOT include any prose outside the JSON object.
- Do NOT include API keys, URLs with credentials, secrets, or
  personally-identifying details from the grounding. Refer to facts
  abstractly when the grounding contains a concrete identifier.`

interface OpenAIChoice {
  message?: { content?: string }
}
interface OpenAIChatResponse {
  choices?: OpenAIChoice[]
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

async function callLLM(
  cfg: EvalConfig,
  systemPrompt: string,
  userPrompt: string,
  fetchImpl: JudgeFetch,
  timeoutMs: number,
): Promise<{ text: string; error: string | null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (cfg.llm.provider === 'anthropic') {
      const baseUrl = cfg.llm.baseUrl ?? 'https://api.anthropic.com'
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.llm.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.llm.model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
        signal: controller.signal,
      })
      if (!res.ok) return { text: '', error: `HTTP ${res.status}` }
      const data = (await res.json()) as AnthropicResponse
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n')
      return { text, error: null }
    }
    // openai + openai-compatible share the same /v1/chat/completions shape.
    const baseUrl = cfg.llm.baseUrl ?? 'https://api.openai.com'
    const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.llm.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })
    if (!res.ok) return { text: '', error: `HTTP ${res.status}` }
    const data = (await res.json()) as OpenAIChatResponse
    return { text: data.choices?.[0]?.message?.content ?? '', error: null }
  } catch (e) {
    return { text: '', error: e instanceof Error ? e.message : 'unreachable' }
  } finally {
    clearTimeout(timer)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface GenerateOptions {
  fetchImpl?: JudgeFetch
  timeoutMs?: number
}

export class QuestionGenerationError extends Error {
  warnings: string[]
  constructor(message: string, warnings: string[] = []) {
    super(message)
    this.name = 'QuestionGenerationError'
    this.warnings = warnings
  }
}

function ceilingFor(mode: EvalMode, requested?: EvalLevel): EvalLevel {
  const ceiling = LEVEL_CEILING_BY_MODE[mode]
  if (requested === undefined) return ceiling
  return (Math.min(ceiling, requested) as EvalLevel)
}

/**
 * Generate (or reuse a cached) question bank for a topic + grounding.
 * Throws QuestionGenerationError when the LLM is not configured, the
 * call fails, or the response cannot be validated into at least one
 * usable question.
 */
export async function generateQuestionBank(
  cfg: EvalConfig,
  request: QuestionGenerationRequest,
  opts: GenerateOptions = {},
): Promise<QuestionGenerationResult> {
  if (!cfg.llm.provider || !cfg.llm.model || !cfg.llm.apiKey) {
    throw new QuestionGenerationError('LLM judge is not configured.')
  }
  const topic = (request.topic ?? '').trim()
  if (!topic) throw new QuestionGenerationError('topic is required')
  const groundingRaw = request.grounding ?? ''
  if (typeof groundingRaw !== 'string' || groundingRaw.trim().length < 20) {
    throw new QuestionGenerationError('grounding is required (min 20 chars of source-of-truth text)')
  }
  const mode = request.mode
  const maxLevel = ceilingFor(mode, request.max_level)

  // Redact + cap BEFORE the network leaves the process: only the
  // redacted, capped string is sent to the LLM and stored in any cache
  // metadata. The cache key, on the other hand, fingerprints the RAW
  // grounding (via SHA-256 — irreversible) so two real groundings that
  // happen to redact to the same string don't collide in the cache.
  // SHA-256 of secret bytes is not a secret leak; it's a one-way hash.
  const groundingRedacted = redactString(groundingRaw)
  const grounding = groundingRedacted.slice(0, GROUNDING_MAX_BYTES)
  const truncated = grounding.length < groundingRedacted.length
  const cacheKey = makeCacheKey(topic, groundingRaw, mode, maxLevel)

  const cached = cache.get(cacheKey)
  if (cached) {
    return {
      cache_key: cacheKey,
      questions: cached.questions,
      warnings: ['cache hit — returning previously generated bank'],
    }
  }

  const fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const userPrompt = [
    `topic: ${topic}`,
    `mode: ${mode}`,
    `max_level: ${maxLevel}`,
    `questions_per_level (target): ${QUESTIONS_PER_LEVEL}`,
    `level_names: ${JSON.stringify(LEVEL_NAMES)}`,
    ``,
    `grounding (operator-pasted, secrets redacted, capped at ${GROUNDING_MAX_BYTES} bytes):`,
    `"""`,
    grounding,
    `"""`,
    ``,
    `Produce a JSON object: {"questions": [...]}`,
  ].join('\n')

  const llm = await callLLM(cfg, SYSTEM_PROMPT, userPrompt, fetchImpl, opts.timeoutMs ?? 90_000)
  if (llm.error) {
    throw new QuestionGenerationError(`LLM call failed: ${llm.error}`)
  }
  if (!llm.text) {
    throw new QuestionGenerationError('LLM returned an empty response')
  }
  let parsed: unknown
  const stripped = llm.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
  try {
    parsed = JSON.parse(stripped)
  } catch {
    throw new QuestionGenerationError('LLM returned non-JSON output')
  }
  const validation = validateGeneratedBank(parsed)
  const warnings = validation.warnings.slice()
  if (truncated) warnings.unshift('grounding was truncated to fit the LLM context cap')

  // Drop questions above max_level — defense against the LLM happily
  // generating L7 questions even when we asked for max_level=1.
  const filtered = validation.valid.filter((q) => q.level <= maxLevel)
  if (filtered.length < validation.valid.length) {
    warnings.push(
      `dropped ${validation.valid.length - filtered.length} question(s) above max_level=${maxLevel}`,
    )
  }
  if (filtered.length === 0) {
    throw new QuestionGenerationError(
      'No valid questions in the LLM response.',
      warnings,
    )
  }

  cache.set(cacheKey, {
    request_hash: cacheKey,
    topic,
    mode,
    max_level: maxLevel,
    generated_at: new Date().toISOString(),
    questions: filtered,
  })

  return { cache_key: cacheKey, questions: filtered, warnings }
}

/**
 * Apply the same level-ceiling and code/topic-drift safety filtering
 * the static bank's selectQuestions does, so an override bank can't
 * smuggle in questions above the requested mode/level.
 */
export function applyOverrideSafetyFilter(
  bank: EvalQuestion[],
  mode: EvalMode,
  maxLevel: EvalLevel | undefined,
  includeCode: boolean,
  includeTopicDrift: boolean,
): { questions: EvalQuestion[]; warnings: string[] } {
  const cap = ceilingFor(mode, maxLevel)
  const warnings: string[] = []
  const initialCount = bank.length
  let out = bank.filter((q) => q.level <= cap)
  if (out.length !== initialCount) {
    warnings.push(`override: dropped ${initialCount - out.length} question(s) above level ${cap}`)
  }
  if (!includeCode) {
    const before = out.length
    out = out.filter((q) => !q.requires_code)
    if (out.length !== before) {
      warnings.push(`override: dropped ${before - out.length} code/npm question(s)`)
    }
  }
  if (!includeTopicDrift) {
    const before = out.length
    out = out.filter((q) => !q.topic_drift)
    if (out.length !== before) {
      warnings.push(`override: dropped ${before - out.length} topic-drift question(s)`)
    }
  }
  // Preserve declaration order; orphan-followup pruning.
  const ids = new Set(out.map((q) => q.id))
  const before = out.length
  out = out.filter((q) => (q.follow_up_of ? ids.has(q.follow_up_of) : true))
  if (out.length !== before) {
    warnings.push(`override: dropped ${before - out.length} orphan follow-up(s)`)
  }
  return { questions: out, warnings }
}
