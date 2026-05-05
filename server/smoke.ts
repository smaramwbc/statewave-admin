/**
 * First-admin-run smoke validation.
 *
 * Runs a minimal end-to-end demo against the connected Statewave backend so
 * the operator can confirm — without manual setup — that ingestion, compile,
 * and webhook delivery are wired up. Triggered automatically on the very
 * first authenticated dashboard load and re-runnable from the UI.
 *
 * Stays vendor-neutral: pure node:* + global fetch, no extra deps. State
 * lives in-process; an optional `ADMIN_SMOKE_STATE_DIR` env var lets the
 * operator persist it across restarts. Calls /v1/episodes and
 * /v1/memories/compile directly with the server-side X-API-Key — those
 * paths sit outside the admin proxy allowlist on purpose, so we never
 * forward them from the browser.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const SMOKE_SUBJECT_ID = 'statewave-demo:first-admin-run'
const STATE_FILENAME = 'smoke-state.json'

// ─── Types ────────────────────────────────────────────────────────────────

export type SmokeOverallStatus =
  | 'never_run'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'disabled'

export type StepStatus = 'ok' | 'failed' | 'skipped'

export type WebhookState =
  | 'configured_delivered'
  | 'configured_pending'
  | 'configured_failed'
  | 'not_configured'
  | 'unknown'

export interface BackendStep {
  status: StepStatus
  detail: string
  readiness?: string
}

export interface DemoJobStep {
  status: StepStatus
  detail: string
  subject_id: string
  episode_id: string | null
  /** Backend compile_jobs row id — links to /jobs in the admin UI. */
  job_id: string | null
  memories_created: number | null
  job_mode: 'sync' | 'async' | null
  subject_visible: boolean
}

export interface DemoWebhookStep {
  status: StepStatus
  detail: string
  state: WebhookState
  total_before: number | null
  total_after: number | null
  /** Compact view of the most recent demo-related event, if any. */
  sample: {
    id: string
    event: string
    status: string
    http_status: number | null
  } | null
}

export interface SmokeResult {
  status: SmokeOverallStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  backend: BackendStep
  demo_job: DemoJobStep
  demo_webhook: DemoWebhookStep
  /** Top-level error when the whole run could not start (e.g. upstream not configured). */
  error: string | null
}

export interface SmokeStatus {
  enabled: boolean
  has_run: boolean
  is_running: boolean
  subject_id: string
  last_result: SmokeResult | null
}

// ─── Config ───────────────────────────────────────────────────────────────

export interface SmokeConfig {
  apiUrl: string | null
  apiKey: string | null
  /** Operator can set ADMIN_SMOKE_DISABLED=true to opt out entirely. */
  disabled: boolean
  /** Optional directory for persisting last-run state across restarts. */
  stateDir: string | null
}

export function getSmokeConfig(env: NodeJS.ProcessEnv = process.env): SmokeConfig {
  return {
    apiUrl: env.STATEWAVE_API_URL ? env.STATEWAVE_API_URL : null,
    apiKey: env.STATEWAVE_API_KEY ? env.STATEWAVE_API_KEY : null,
    disabled: env.ADMIN_SMOKE_DISABLED === 'true',
    stateDir: env.ADMIN_SMOKE_STATE_DIR ? resolve(env.ADMIN_SMOKE_STATE_DIR) : null,
  }
}

// ─── In-process state ─────────────────────────────────────────────────────

interface InternalState {
  isRunning: boolean
  lastResult: SmokeResult | null
  /** Single-flight: in-flight run promise, if any. */
  inFlight: Promise<SmokeResult> | null
  /** Set the first time we successfully read persisted state from disk. */
  loadedFromDisk: boolean
}

const state: InternalState = {
  isRunning: false,
  lastResult: null,
  inFlight: null,
  loadedFromDisk: false,
}

/** Reset module state — exposed for tests; not part of the wire contract. */
export function _resetSmokeStateForTests(): void {
  state.isRunning = false
  state.lastResult = null
  state.inFlight = null
  state.loadedFromDisk = false
}

async function loadFromDisk(cfg: SmokeConfig): Promise<void> {
  if (state.loadedFromDisk) return
  state.loadedFromDisk = true
  if (!cfg.stateDir) return
  try {
    const text = await readFile(join(cfg.stateDir, STATE_FILENAME), 'utf8')
    const parsed = JSON.parse(text) as SmokeResult
    if (parsed && typeof parsed === 'object') state.lastResult = parsed
  } catch {
    // First boot or unreadable file — leave lastResult null.
  }
}

async function persistToDisk(cfg: SmokeConfig, result: SmokeResult): Promise<void> {
  if (!cfg.stateDir) return
  try {
    await mkdir(cfg.stateDir, { recursive: true })
    await writeFile(
      join(cfg.stateDir, STATE_FILENAME),
      JSON.stringify(result, null, 2),
      'utf8',
    )
  } catch {
    // Persistence is best-effort. Operators who want durability set
    // ADMIN_SMOKE_STATE_DIR to writable storage; on failure we still
    // hold the result in memory.
  }
}

// ─── Upstream HTTP helpers ────────────────────────────────────────────────

/** Pluggable fetch — overridable in tests. Defaults to the global. */
export type UpstreamFetch = (
  url: string,
  init: RequestInit,
) => Promise<Response>

interface UpstreamCallOptions {
  fetchImpl: UpstreamFetch
  /** Per-request timeout. Smoke runs intentionally cap individual calls. */
  timeoutMs?: number
}

async function upstreamCall<T>(
  cfg: SmokeConfig,
  method: string,
  path: string,
  body: object | null,
  opts: UpstreamCallOptions,
): Promise<{ status: number; data: T | null; error: string | null }> {
  if (!cfg.apiUrl) {
    return { status: 0, data: null, error: 'STATEWAVE_API_URL not configured' }
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey
  const init: RequestInit = { method, headers }
  if (body !== null) init.body = JSON.stringify(body)

  const controller = new AbortController()
  const timer = opts.timeoutMs
    ? setTimeout(() => controller.abort(), opts.timeoutMs)
    : null
  init.signal = controller.signal

  try {
    const res = await opts.fetchImpl(`${cfg.apiUrl}${path}`, init)
    const text = await res.text()
    let data: T | null = null
    if (text.length > 0) {
      try {
        data = JSON.parse(text) as T
      } catch {
        data = null
      }
    }
    if (!res.ok) {
      return {
        status: res.status,
        data,
        error: `HTTP ${res.status}`,
      }
    }
    return { status: res.status, data, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unreachable'
    return { status: 0, data: null, error: msg }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// ─── Step bodies ──────────────────────────────────────────────────────────

interface ReadinessResponse {
  status?: string
}

interface DashboardResponse {
  readiness?: { status?: string }
  webhooks?: { total?: number }
}

interface EpisodeResponse {
  id?: string
}

interface CompileAsyncResponse {
  job_id?: string
  status?: string
}

interface CompileJobStatusResponse {
  job_id?: string
  status?: 'pending' | 'running' | 'completed' | 'failed' | string
  memories_created?: number
  error?: string
}

interface SubjectDetailResponse {
  subject_id?: string
  summary?: { episode_count?: number }
}

interface WebhookStatsResponse {
  total?: number
  pending?: number
  delivered?: number
  dead_letter?: number
}

interface WebhookListItem {
  id?: string
  event?: string
  status?: string
  http_status?: number | null
}

interface WebhookListResponse {
  events?: WebhookListItem[]
}

async function checkBackend(
  cfg: SmokeConfig,
  opts: UpstreamCallOptions,
): Promise<BackendStep> {
  if (!cfg.apiUrl) {
    return {
      status: 'failed',
      detail: 'STATEWAVE_API_URL is not configured on the admin server.',
    }
  }
  // /readyz is unauthenticated and fast; /admin/dashboard requires the API
  // key. We try /readyz first for a clean signal, then fall back to the
  // admin dashboard which doubles as our auth-+-reachability probe.
  const ready = await upstreamCall<ReadinessResponse>(
    cfg,
    'GET',
    '/readyz',
    null,
    opts,
  )
  if (ready.error || !ready.data) {
    return {
      status: 'failed',
      detail: `Backend not reachable at ${cfg.apiUrl} (${ready.error ?? 'no response'}).`,
    }
  }
  const dash = await upstreamCall<DashboardResponse>(
    cfg,
    'GET',
    '/admin/dashboard',
    null,
    opts,
  )
  if (dash.error || !dash.data) {
    return {
      status: 'failed',
      detail: `Admin dashboard probe failed (${dash.error ?? 'no response'}). Check STATEWAVE_API_KEY has admin scope.`,
      readiness: ready.data.status,
    }
  }
  return {
    status: 'ok',
    detail: 'Backend is reachable and admin scope is valid.',
    readiness: ready.data.status ?? dash.data.readiness?.status,
  }
}

interface JobPollOptions {
  /** Poll interval between status checks. Defaults to 500ms. */
  pollIntervalMs: number
  /** Total time to wait for the job to leave pending/running. Defaults to 15s. */
  pollTimeoutMs: number
  /** Pluggable sleep so tests can short-circuit waiting. */
  sleep: (ms: number) => Promise<void>
}

async function runDemoJob(
  cfg: SmokeConfig,
  opts: UpstreamCallOptions,
  pollOpts: JobPollOptions,
  startedAtIso: string,
): Promise<DemoJobStep> {
  const subjectId = SMOKE_SUBJECT_ID
  const episode = await upstreamCall<EpisodeResponse>(
    cfg,
    'POST',
    '/v1/episodes',
    {
      subject_id: subjectId,
      source: 'statewave-admin-smoke',
      type: 'note',
      payload: {
        text: 'First-admin-run smoke episode. Safe to delete.',
      },
      metadata: {
        smoke: true,
        run_started_at: startedAtIso,
      },
      provenance: {
        origin: 'statewave-admin',
        purpose: 'first-run-smoke-check',
      },
    },
    opts,
  )
  if (episode.error || !episode.data?.id) {
    return {
      status: 'failed',
      detail: `Demo episode ingestion failed: ${episode.error ?? 'no episode id returned'}.`,
      subject_id: subjectId,
      episode_id: null,
      job_id: null,
      memories_created: null,
      job_mode: null,
      subject_visible: false,
    }
  }
  const episodeId = episode.data.id

  // Async compile so a row lands in `compile_jobs` and shows up on the
  // admin /jobs page — that's the visible artifact the operator looks at
  // to confirm the compile pipeline is wired up. Sync mode runs inline
  // and never persists a job row, so it would leave /jobs empty even on
  // a healthy run.
  const compile = await upstreamCall<CompileAsyncResponse>(
    cfg,
    'POST',
    '/v1/memories/compile',
    {
      subject_id: subjectId,
      async: true,
    },
    opts,
  )
  if (compile.error || !compile.data?.job_id) {
    return {
      status: 'failed',
      detail: `Compile call failed for demo subject: ${compile.error ?? 'no job_id returned'}.`,
      subject_id: subjectId,
      episode_id: episodeId,
      job_id: null,
      memories_created: null,
      job_mode: 'async',
      subject_visible: false,
    }
  }
  const jobId = compile.data.job_id

  // Poll the durable job status until it reaches completed/failed or we
  // exhaust the budget. The backend marks tiny demo subjects done in
  // well under a second, so the loop typically returns on the first or
  // second probe.
  const pollStart = Date.now()
  let lastStatus: CompileJobStatusResponse | null = null
  let memoriesCreated: number | null = null
  let pollError: string | null = null

  // First probe outside the wait loop so the test path with an
  // immediately-completed job records zero sleeps.
  while (true) {
    const probe = await upstreamCall<CompileJobStatusResponse>(
      cfg,
      'GET',
      `/v1/memories/compile/${encodeURIComponent(jobId)}`,
      null,
      opts,
    )
    if (probe.error || !probe.data) {
      pollError = probe.error ?? 'no job status returned'
      break
    }
    lastStatus = probe.data
    if (probe.data.status === 'completed') {
      memoriesCreated =
        typeof probe.data.memories_created === 'number'
          ? probe.data.memories_created
          : null
      break
    }
    if (probe.data.status === 'failed') {
      pollError = probe.data.error ?? 'compile job reported failed'
      break
    }
    if (Date.now() - pollStart >= pollOpts.pollTimeoutMs) {
      pollError = `compile job did not finish within ${Math.round(pollOpts.pollTimeoutMs / 1000)}s (last status: ${probe.data.status ?? 'unknown'})`
      break
    }
    await pollOpts.sleep(pollOpts.pollIntervalMs)
  }

  if (pollError || lastStatus?.status !== 'completed') {
    return {
      status: 'failed',
      detail: `Compile job ${jobId} did not complete: ${pollError ?? 'unknown failure'}. Inspect /jobs for details.`,
      subject_id: subjectId,
      episode_id: episodeId,
      job_id: jobId,
      memories_created: memoriesCreated,
      job_mode: 'async',
      subject_visible: false,
    }
  }

  const detail = await upstreamCall<SubjectDetailResponse>(
    cfg,
    'GET',
    `/admin/subjects/${encodeURIComponent(subjectId)}`,
    null,
    opts,
  )
  const subjectVisible =
    !detail.error && (detail.data?.summary?.episode_count ?? 0) > 0

  if (!subjectVisible) {
    return {
      status: 'failed',
      detail: `Demo subject did not appear in /admin/subjects/${subjectId} after compile.`,
      subject_id: subjectId,
      episode_id: episodeId,
      job_id: jobId,
      memories_created: memoriesCreated,
      job_mode: 'async',
      subject_visible: false,
    }
  }

  return {
    status: 'ok',
    detail:
      memoriesCreated !== null
        ? `Ingested 1 demo episode, compile job ${jobId} completed with ${memoriesCreated} memory record${memoriesCreated === 1 ? '' : 's'} — visible in /jobs.`
        : `Ingested 1 demo episode and compile job ${jobId} completed — visible in /jobs.`,
    subject_id: subjectId,
    episode_id: episodeId,
    job_id: jobId,
    memories_created: memoriesCreated,
    job_mode: 'async',
    subject_visible: true,
  }
}

async function checkDemoWebhook(
  cfg: SmokeConfig,
  opts: UpstreamCallOptions,
  totalBefore: number | null,
): Promise<DemoWebhookStep> {
  const stats = await upstreamCall<WebhookStatsResponse>(
    cfg,
    'GET',
    '/admin/webhooks/stats',
    null,
    opts,
  )
  if (stats.error || !stats.data) {
    return {
      status: 'failed',
      detail: `Could not read webhook stats: ${stats.error ?? 'no data'}.`,
      state: 'unknown',
      total_before: totalBefore,
      total_after: null,
      sample: null,
    }
  }
  const totalAfter = stats.data.total ?? 0

  // The backend's webhooks.fire() is a no-op when no STATEWAVE_WEBHOOK_URL
  // is configured — no row is persisted at all. So if the demo episode +
  // compile produced zero new rows, treat that as "webhooks not
  // configured" rather than a failure. This is the neutral state the spec
  // asks for.
  if (totalBefore !== null && totalAfter <= totalBefore) {
    return {
      status: 'skipped',
      detail:
        'Webhooks are not configured on the backend — nothing to test. Set STATEWAVE_WEBHOOK_URL on the Statewave server (e.g. https://webhook.site/<id> or a local sink) and rerun the smoke check to verify delivery.',
      state: 'not_configured',
      total_before: totalBefore,
      total_after: totalAfter,
      sample: null,
    }
  }

  // Pull the most recent event (first in created_at-desc order) so we can
  // surface delivery status to the operator.
  const list = await upstreamCall<WebhookListResponse>(
    cfg,
    'GET',
    '/admin/webhooks?limit=1',
    null,
    opts,
  )
  const sample = list.data?.events?.[0] ?? null

  if (!sample) {
    return {
      status: 'ok',
      detail: 'Webhook event count increased — delivery infrastructure is wired up.',
      state: 'configured_pending',
      total_before: totalBefore,
      total_after: totalAfter,
      sample: null,
    }
  }

  const sampleStatus = sample.status ?? 'unknown'
  const sampleId = sample.id ?? ''
  const sampleEvent = sample.event ?? 'unknown'
  const sampleHttp = sample.http_status ?? null

  if (sampleStatus === 'delivered') {
    return {
      status: 'ok',
      detail: `Most recent webhook (${sampleEvent}) was delivered successfully.`,
      state: 'configured_delivered',
      total_before: totalBefore,
      total_after: totalAfter,
      sample: {
        id: sampleId,
        event: sampleEvent,
        status: sampleStatus,
        http_status: sampleHttp,
      },
    }
  }
  if (sampleStatus === 'pending') {
    return {
      status: 'ok',
      detail: `Most recent webhook (${sampleEvent}) is queued for delivery.`,
      state: 'configured_pending',
      total_before: totalBefore,
      total_after: totalAfter,
      sample: {
        id: sampleId,
        event: sampleEvent,
        status: sampleStatus,
        http_status: sampleHttp,
      },
    }
  }
  return {
    status: 'failed',
    detail: `Most recent webhook (${sampleEvent}) is in '${sampleStatus}' state. Inspect /webhooks for details.`,
    state: 'configured_failed',
    total_before: totalBefore,
    total_after: totalAfter,
    sample: {
      id: sampleId,
      event: sampleEvent,
      status: sampleStatus,
      http_status: sampleHttp,
    },
  }
}

async function readWebhookTotal(
  cfg: SmokeConfig,
  opts: UpstreamCallOptions,
): Promise<number | null> {
  const stats = await upstreamCall<WebhookStatsResponse>(
    cfg,
    'GET',
    '/admin/webhooks/stats',
    null,
    opts,
  )
  if (stats.error || !stats.data) return null
  return typeof stats.data.total === 'number' ? stats.data.total : null
}

// ─── Public API ───────────────────────────────────────────────────────────

export interface RunSmokeOptions {
  fetchImpl?: UpstreamFetch
  /** Per-call timeout in ms. Overall run typically completes in a few seconds. */
  timeoutMs?: number
  /** Interval between compile-job status polls. Defaults to 500ms. */
  pollIntervalMs?: number
  /** Total budget for the compile job to leave pending/running. Defaults to 15s. */
  pollTimeoutMs?: number
  /** Pluggable sleep — tests pass an immediate-resolve to skip waiting. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Single-flight run of the full smoke suite. Re-entrant calls while a run is
 * in flight return the same promise so we never spam the backend with
 * duplicate demo data.
 */
export async function runSmoke(
  cfg: SmokeConfig,
  opts: RunSmokeOptions = {},
): Promise<SmokeResult> {
  if (cfg.disabled) {
    return {
      status: 'disabled',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: 0,
      backend: { status: 'skipped', detail: 'Smoke check disabled by ADMIN_SMOKE_DISABLED=true.' },
      demo_job: {
        status: 'skipped',
        detail: 'Skipped — smoke disabled.',
        subject_id: SMOKE_SUBJECT_ID,
        episode_id: null,
        job_id: null,
        memories_created: null,
        job_mode: null,
        subject_visible: false,
      },
      demo_webhook: {
        status: 'skipped',
        detail: 'Skipped — smoke disabled.',
        state: 'unknown',
        total_before: null,
        total_after: null,
        sample: null,
      },
      error: null,
    }
  }
  if (state.inFlight) return state.inFlight

  const fetchImpl: UpstreamFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const callOpts: UpstreamCallOptions = {
    fetchImpl,
    timeoutMs: opts.timeoutMs ?? 15_000,
  }
  const pollOpts: JobPollOptions = {
    pollIntervalMs: opts.pollIntervalMs ?? 500,
    pollTimeoutMs: opts.pollTimeoutMs ?? 15_000,
    sleep:
      opts.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  }

  state.isRunning = true
  const startedAt = new Date()
  const startedAtIso = startedAt.toISOString()

  const promise = (async (): Promise<SmokeResult> => {
    const backend = await checkBackend(cfg, callOpts)
    if (backend.status !== 'ok') {
      const finished = new Date()
      return {
        status: 'failed',
        started_at: startedAtIso,
        finished_at: finished.toISOString(),
        duration_ms: finished.getTime() - startedAt.getTime(),
        backend,
        demo_job: {
          status: 'skipped',
          detail: 'Skipped — backend probe did not pass.',
          subject_id: SMOKE_SUBJECT_ID,
          episode_id: null,
          job_id: null,
          memories_created: null,
          job_mode: null,
          subject_visible: false,
        },
        demo_webhook: {
          status: 'skipped',
          detail: 'Skipped — backend probe did not pass.',
          state: 'unknown',
          total_before: null,
          total_after: null,
          sample: null,
        },
        error: backend.detail,
      }
    }

    const totalBefore = await readWebhookTotal(cfg, callOpts)
    const demoJob = await runDemoJob(cfg, callOpts, pollOpts, startedAtIso)
    const demoWebhook =
      demoJob.status === 'ok'
        ? await checkDemoWebhook(cfg, callOpts, totalBefore)
        : ({
            status: 'skipped' as StepStatus,
            detail: 'Skipped — demo job did not complete.',
            state: 'unknown' as WebhookState,
            total_before: totalBefore,
            total_after: null,
            sample: null,
          } satisfies DemoWebhookStep)

    const finished = new Date()

    let overall: SmokeOverallStatus
    if (demoJob.status !== 'ok') overall = 'failed'
    else if (demoWebhook.status === 'failed') overall = 'partial'
    else overall = 'success'

    return {
      status: overall,
      started_at: startedAtIso,
      finished_at: finished.toISOString(),
      duration_ms: finished.getTime() - startedAt.getTime(),
      backend,
      demo_job: demoJob,
      demo_webhook: demoWebhook,
      error: null,
    }
  })()

  state.inFlight = promise
  try {
    const result = await promise
    state.lastResult = result
    await persistToDisk(cfg, result)
    return result
  } finally {
    state.isRunning = false
    state.inFlight = null
  }
}

export async function getSmokeStatus(cfg: SmokeConfig): Promise<SmokeStatus> {
  await loadFromDisk(cfg)
  return {
    enabled: !cfg.disabled,
    has_run: state.lastResult !== null,
    is_running: state.isRunning,
    subject_id: SMOKE_SUBJECT_ID,
    last_result: state.lastResult,
  }
}
