/**
 * Vendor-neutral HTTP handlers for statewave-admin.
 *
 * Plain Node `IncomingMessage` / `ServerResponse` — no `@vercel/node`, no
 * platform-specific helpers. The same handlers are mounted by:
 *
 *   - the standalone Node server  (server/index.ts)
 *   - the Vite dev plugin         (server/vite-plugin.ts)
 *   - or any custom Express/Connect/Fastify host that wires them up.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import {
  checkRequestAuth,
  getAuthConfig,
  loginResult,
  logoutResult,
  sessionResult,
  type RequestLike,
} from './auth.js'
import { getProxyConfig, proxyAdminRequest } from './proxy.js'
import { getSmokeConfig, getSmokeStatus, runSmoke } from './smoke.js'
import {
  getEvalStatus,
  startEvalRun,
  getLatest as getLatestEvalReport,
  getById as getEvalReportById,
  renderMarkdownReport,
} from './self-healing-eval/index.js'
import { getEvalConfig } from './self-healing-eval/config.js'
import { redactValue } from './self-healing-eval/redact.js'
import {
  generateQuestionBank,
  QuestionGenerationError,
} from './self-healing-eval/questionGenerator.js'
import {
  suggestGrounding,
  GroundingSuggestionError,
} from './self-healing-eval/groundingSuggester.js'
import type {
  EvalMode,
  EvalRunOptions,
  QuestionGenerationRequest,
} from './self-healing-eval/types.js'

export const ROUTES = {
  session: '/api/auth/session',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  proxy: '/api/proxy',
  smokeStatus: '/api/admin/smoke/status',
  smokeRun: '/api/admin/smoke/run',
  evalStatus: '/api/self-healing-eval/status',
  evalRun: '/api/self-healing-eval/run',
  evalReportLatest: '/api/self-healing-eval/report/latest',
  /** GET /api/self-healing-eval/report/<runId> — handled by prefix match. */
  evalReportPrefix: '/api/self-healing-eval/report/',
  evalQuestionsGenerate: '/api/self-healing-eval/questions/generate',
  evalGroundingSuggest: '/api/self-healing-eval/grounding/suggest',
} as const

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function asRequestLike(req: IncomingMessage): RequestLike {
  return { headers: req.headers as RequestLike['headers'] }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: object,
  extra: Record<string, string> = {},
): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export async function handleSession(req: IncomingMessage, res: ServerResponse) {
  const cfg = getAuthConfig()
  const r = sessionResult(asRequestLike(req), cfg)
  sendJson(res, r.status, r.body)
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const cfg = getAuthConfig()
  let parsed: unknown
  try {
    const text = await readBody(req)
    parsed = text ? JSON.parse(text) : {}
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const password = (parsed as { password?: unknown }).password
  const r = loginResult(password, cfg)
  sendJson(res, r.status, r.body, r.setCookie ? { 'Set-Cookie': r.setCookie } : {})
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const cfg = getAuthConfig()
  const r = logoutResult(cfg)
  sendJson(res, r.status, r.body, r.setCookie ? { 'Set-Cookie': r.setCookie } : {})
}

export async function handleProxy(req: IncomingMessage, res: ServerResponse) {
  const authCfg = getAuthConfig()
  const auth = checkRequestAuth(asRequestLike(req), authCfg)
  if (!auth.ok) {
    const status = auth.reason === 'misconfigured' ? 503 : auth.status
    const error =
      auth.reason === 'misconfigured' ? 'auth_not_configured' : 'unauthorized'
    return sendJson(res, status, { error })
  }
  const proxyCfg = getProxyConfig()
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.searchParams.get('path') ?? ''
  const method = (req.method ?? 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req)
  const r = await proxyAdminRequest(
    {
      method,
      path,
      body: body && body.length > 0 ? body : null,
      identityEmail: auth.email ?? null,
    },
    proxyCfg,
  )
  res.statusCode = r.status
  res.setHeader('Content-Type', r.contentType)
  res.end(r.body)
}

/**
 * First-admin-run smoke check.
 *
 * The smoke flow ingests + compiles a tiny demo subject and inspects webhook
 * delivery to confirm a fresh admin install is wired up to a healthy
 * backend. It is privileged: every call goes through the same auth gate as
 * /api/proxy, so unauthenticated browsers cannot trigger demo writes.
 *
 * The two endpoints are kept narrow — status is read-only, run is the only
 * mutating call — so the dispatch surface stays auditable.
 */
export async function handleSmokeStatus(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const authCfg = getAuthConfig()
  const auth = checkRequestAuth(asRequestLike(req), authCfg)
  if (!auth.ok) {
    const status = auth.reason === 'misconfigured' ? 503 : auth.status
    const error =
      auth.reason === 'misconfigured' ? 'auth_not_configured' : 'unauthorized'
    return sendJson(res, status, { error })
  }
  const smokeCfg = getSmokeConfig()
  const status = await getSmokeStatus(smokeCfg)
  return sendJson(res, 200, status as unknown as Record<string, unknown>)
}

export async function handleSmokeRun(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const authCfg = getAuthConfig()
  const auth = checkRequestAuth(asRequestLike(req), authCfg)
  if (!auth.ok) {
    const status = auth.reason === 'misconfigured' ? 503 : auth.status
    const error =
      auth.reason === 'misconfigured' ? 'auth_not_configured' : 'unauthorized'
    return sendJson(res, status, { error })
  }
  const smokeCfg = getSmokeConfig()
  const result = await runSmoke(smokeCfg)
  return sendJson(res, 200, result as unknown as Record<string, unknown>)
}

/**
 * Self-Healing Eval handlers.
 *
 * Same auth gate as /api/proxy. Status is read-only. Run kicks off a
 * background eval (returns immediately with run_id). Report endpoints
 * fetch the persisted JSON or markdown rendering.
 *
 * Every JSON response is run through `redactValue` so a response leaking
 * to the browser cache cannot contain an API key — defense in depth on
 * top of the in-module redaction during persistence.
 */
async function gateEval(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const authCfg = getAuthConfig()
  const auth = checkRequestAuth(asRequestLike(req), authCfg)
  if (!auth.ok) {
    const status = auth.reason === 'misconfigured' ? 503 : auth.status
    const error =
      auth.reason === 'misconfigured' ? 'auth_not_configured' : 'unauthorized'
    sendJson(res, status, { error })
    return false
  }
  return true
}

export async function handleEvalStatus(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  const status = await getEvalStatus()
  return sendJson(res, 200, redactValue(status) as unknown as Record<string, unknown>)
}

export async function handleEvalRun(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  let parsed: unknown
  try {
    const text = await readBody(req)
    parsed = text ? JSON.parse(text) : {}
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const options = (parsed ?? {}) as EvalRunOptions
  const result = await startEvalRun(options)
  if (!result.ok) {
    return sendJson(res, 409, {
      ok: false,
      error: result.error ?? 'cannot start',
      run_id: result.run_id,
      status: result.status,
    })
  }
  return sendJson(res, 202, redactValue(result) as unknown as Record<string, unknown>)
}

export async function handleEvalReportLatest(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  const cfg = getEvalConfig()
  const report = await getLatestEvalReport(cfg.storagePath)
  if (!report) {
    return sendJson(res, 404, { error: 'no_report_yet' })
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.searchParams.get('format') === 'markdown') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.end(renderMarkdownReport(report))
    return
  }
  return sendJson(res, 200, redactValue(report) as unknown as Record<string, unknown>)
}

/**
 * POST /api/self-healing-eval/questions/generate
 *
 * Operator-driven LLM-backed question bank generation. Auth-gated by
 * the same session/gateway check as the rest of the eval surface.
 * Grounding text is capped + redacted before reaching the LLM (see
 * questionGenerator.ts). The generated bank is cached in-memory keyed
 * by hash(topic+grounding+mode+max_level) so a regenerate-then-run
 * sequence is reproducible.
 */
export async function handleEvalQuestionsGenerate(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  let parsed: unknown
  try {
    const text = await readBody(req)
    parsed = text ? JSON.parse(text) : {}
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const obj = (parsed ?? {}) as Partial<QuestionGenerationRequest>
  const topic = typeof obj.topic === 'string' ? obj.topic.trim() : ''
  const grounding = typeof obj.grounding === 'string' ? obj.grounding : ''
  const mode = typeof obj.mode === 'string' ? (obj.mode as EvalMode) : null
  if (!topic) return sendJson(res, 400, { error: 'topic_required' })
  if (!grounding || grounding.trim().length < 20) {
    return sendJson(res, 400, { error: 'grounding_required' })
  }
  if (mode !== 'smoke' && mode !== 'developer' && mode !== 'full') {
    return sendJson(res, 400, { error: 'invalid_mode' })
  }
  const cfg = getEvalConfig()
  if (!cfg.llm.provider || !cfg.llm.model || !cfg.llm.apiKey) {
    return sendJson(res, 503, { error: 'llm_not_configured' })
  }
  try {
    const result = await generateQuestionBank(cfg, {
      topic,
      grounding,
      mode,
      max_level: obj.max_level,
    })
    return sendJson(res, 200, redactValue(result) as unknown as Record<string, unknown>)
  } catch (e) {
    if (e instanceof QuestionGenerationError) {
      return sendJson(res, 422, {
        error: 'generation_failed',
        message: e.message,
        warnings: e.warnings,
      })
    }
    return sendJson(res, 500, { error: 'internal_error' })
  }
}

/**
 * POST /api/self-healing-eval/grounding/suggest
 *
 * Operator picked a subject in the diagnostics UI; this endpoint pulls
 * that subject's compiled memories from the connected Statewave
 * backend, redacts + caps them, and asks the LLM judge to produce a
 * concise `{ topic, grounding }` pair the operator can drop into the
 * question generator.
 */
export async function handleEvalGroundingSuggest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  let parsed: unknown
  try {
    const text = await readBody(req)
    parsed = text ? JSON.parse(text) : {}
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const obj = (parsed ?? {}) as { subject_id?: unknown; max_memories?: unknown }
  const subjectId = typeof obj.subject_id === 'string' ? obj.subject_id.trim() : ''
  if (!subjectId) return sendJson(res, 400, { error: 'subject_id_required' })
  const maxMemories =
    typeof obj.max_memories === 'number' && obj.max_memories > 0
      ? obj.max_memories
      : undefined
  const cfg = getEvalConfig()
  try {
    const result = await suggestGrounding(cfg, {
      subject_id: subjectId,
      max_memories: maxMemories,
    })
    return sendJson(res, 200, redactValue(result) as unknown as Record<string, unknown>)
  } catch (e) {
    if (e instanceof GroundingSuggestionError) {
      return sendJson(res, e.status, {
        error: e.status === 503 ? 'llm_not_configured' : 'suggestion_failed',
        message: e.message,
      })
    }
    return sendJson(res, 500, { error: 'internal_error' })
  }
}

export async function handleEvalReportById(
  req: IncomingMessage,
  res: ServerResponse,
  runId: string,
) {
  if ((req.method ?? 'GET').toUpperCase() !== 'GET') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  if (!(await gateEval(req, res))) return
  const cfg = getEvalConfig()
  const report = await getEvalReportById(cfg.storagePath, runId)
  if (!report) {
    return sendJson(res, 404, { error: 'not_found' })
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.searchParams.get('format') === 'markdown') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    res.end(renderMarkdownReport(report))
    return
  }
  return sendJson(res, 200, redactValue(report) as unknown as Record<string, unknown>)
}

/**
 * Single dispatcher — returns true if the request was handled by an admin
 * route, false if the host should serve its own response (e.g. static asset
 * or 404). Vendor-neutral: works behind any Node-based proxy or server.
 */
export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const p = url.pathname
  if (p === ROUTES.session) {
    await handleSession(req, res)
    return true
  }
  if (p === ROUTES.login) {
    await handleLogin(req, res)
    return true
  }
  if (p === ROUTES.logout) {
    await handleLogout(req, res)
    return true
  }
  if (p === ROUTES.proxy) {
    await handleProxy(req, res)
    return true
  }
  if (p === ROUTES.smokeStatus) {
    await handleSmokeStatus(req, res)
    return true
  }
  if (p === ROUTES.smokeRun) {
    await handleSmokeRun(req, res)
    return true
  }
  if (p === ROUTES.evalStatus) {
    await handleEvalStatus(req, res)
    return true
  }
  if (p === ROUTES.evalRun) {
    await handleEvalRun(req, res)
    return true
  }
  if (p === ROUTES.evalReportLatest) {
    await handleEvalReportLatest(req, res)
    return true
  }
  if (p === ROUTES.evalQuestionsGenerate) {
    await handleEvalQuestionsGenerate(req, res)
    return true
  }
  if (p === ROUTES.evalGroundingSuggest) {
    await handleEvalGroundingSuggest(req, res)
    return true
  }
  if (p.startsWith(ROUTES.evalReportPrefix)) {
    const runId = p.slice(ROUTES.evalReportPrefix.length)
    if (runId && runId !== 'latest') {
      await handleEvalReportById(req, res, decodeURIComponent(runId))
      return true
    }
  }
  return false
}
