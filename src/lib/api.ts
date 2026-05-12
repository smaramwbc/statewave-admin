/**
 * Admin API client — typed fetch functions for backend endpoints.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SubjectListItem {
  subject_id: string
  tenant_id: string | null
  episode_count: number
  memory_count: number
  last_episode_at: string | null
  health_state: string | null
  health_score: number | null
  open_sessions: number
}

export interface SubjectListResponse {
  subjects: SubjectListItem[]
  total: number
  limit: number
  offset: number
}

export interface SubjectSummary {
  episode_count: number
  memory_count: number
  session_count: number
  first_seen_at: string | null
  last_activity_at: string | null
}

export interface SubjectHealthSummary {
  score: number
  state: string
  factors: Array<{ signal: string; impact: number; detail: string }>
}

export interface SubjectSLASummary {
  total_sessions: number
  resolved_sessions: number
  open_sessions: number
  avg_first_response_seconds: number | null
  avg_resolution_seconds: number | null
  first_response_breach_count: number
  resolution_breach_count: number
}

export interface SubjectDetailResponse {
  subject_id: string
  tenant_id: string | null
  summary: SubjectSummary
  health: SubjectHealthSummary | null
  sla: SubjectSLASummary | null
}

export interface MemoryListItem {
  id: string
  kind: string
  content: string
  summary: string
  confidence: number
  status: string
  source_episode_ids: string[]
  valid_from: string
  valid_to: string | null
  /**
   * Per-memory capability tags consumed by the sensitivity-label
   * policy layer (#50). Optional — older servers pre-policy-layer
   * omit the field, in which case treat as untagged (default-allow).
   */
  sensitivity_labels?: string[]
  created_at: string
}

export interface MemoryListResponse {
  memories: MemoryListItem[]
  total: number
  limit: number
  offset: number
}

export interface EpisodeListItem {
  id: string
  session_id: string | null
  source: string
  type: string
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  provenance: Record<string, unknown>
  created_at: string
}

export interface EpisodeListResponse {
  episodes: EpisodeListItem[]
  total: number
  limit: number
  offset: number
}

export interface DashboardData {
  readiness: {
    status: string
    checks: { name: string; status: string; detail: string; latency_ms: number }[]
  }
  migration: {
    current_revision: string | null
    expected_head: string
    is_compatible: boolean
    pending_count: number
  }
  counts: { episodes: number; memories: number; subjects: number }
  jobs: Record<string, number>
  webhooks: { total: number; delivered: number; pending: number; dead_letter: number }
  health_distribution: Record<string, number> | null
}

export interface UsageWindow {
  today: number
  '7d': number
  '30d': number
  total: number
}

export interface UsageData {
  episodes: UsageWindow
  memories: UsageWindow
  compile_jobs: UsageWindow
  webhooks: UsageWindow
  active_subjects: { '7d': number; '30d': number; total: number }
  generated_at: string
  tenant_id: string | null
}

// ─── Config ──────────────────────────────────────────────────────────────────

function adminUrl(path: string): string {
  return `/api/proxy?path=${encodeURIComponent(path)}`
}

// ─── API Functions ───────────────────────────────────────────────────────────

export async function fetchDashboard(): Promise<DashboardData> {
  const res = await fetch(adminUrl('/admin/dashboard'))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchUsage(tenantId?: string): Promise<UsageData> {
  let path = '/admin/usage'
  if (tenantId) path += `?tenant_id=${encodeURIComponent(tenantId)}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchTenants(): Promise<string[]> {
  const res = await fetch(adminUrl('/admin/tenants'))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.tenants || []
}

export interface SubjectListParams {
  search?: string
  tenant_id?: string
  health_state?: string
  has_open_sessions?: boolean
  sort_by?: 'subject_id' | 'last_activity' | 'episode_count' | 'memory_count'
  sort_order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

export async function fetchSubjects(params: SubjectListParams = {}): Promise<SubjectListResponse> {
  const query = new URLSearchParams()
  if (params.search) query.set('search', params.search)
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.health_state) query.set('health_state', params.health_state)
  if (params.has_open_sessions !== undefined) query.set('has_open_sessions', String(params.has_open_sessions))
  if (params.sort_by) query.set('sort_by', params.sort_by)
  if (params.sort_order) query.set('sort_order', params.sort_order)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/subjects${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchSubjectDetail(subjectId: string, tenantId?: string): Promise<SubjectDetailResponse> {
  let path = `/admin/subjects/${encodeURIComponent(subjectId)}`
  if (tenantId) path += `?tenant_id=${encodeURIComponent(tenantId)}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) {
    if (res.status === 404) throw new Error('Subject not found')
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json()
}

export interface MemoryListParams {
  tenant_id?: string
  status?: 'active' | 'superseded' | 'all'
  kind?: string
  search?: string
  limit?: number
  offset?: number
}

export async function fetchSubjectMemories(
  subjectId: string,
  params: MemoryListParams = {}
): Promise<MemoryListResponse> {
  const query = new URLSearchParams()
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.status) query.set('status', params.status)
  if (params.kind) query.set('kind', params.kind)
  if (params.search) query.set('search', params.search)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/memories${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface EpisodeListParams {
  tenant_id?: string
  session_id?: string
  type?: string
  search?: string
  limit?: number
  offset?: number
}

export async function fetchSubjectEpisodes(
  subjectId: string,
  params: EpisodeListParams = {}
): Promise<EpisodeListResponse> {
  const query = new URLSearchParams()
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.session_id) query.set('session_id', params.session_id)
  if (params.type) query.set('type', params.type)
  if (params.search) query.set('search', params.search)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/episodes${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Citing Memories (Reverse Provenance) ────────────────────────────────────

export interface CitingMemoriesParams {
  tenant_id?: string
  limit?: number
  offset?: number
}

export async function fetchCitingMemories(
  subjectId: string,
  episodeId: string,
  params: CitingMemoriesParams = {}
): Promise<MemoryListResponse> {
  const query = new URLSearchParams()
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.limit) query.set('limit', String(params.limit))
  if (params.offset) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/episodes/${encodeURIComponent(episodeId)}/citing-memories${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface SessionListItem {
  session_id: string
  status: 'open' | 'resolved'
  first_message_at: string
  first_response_at: string | null
  resolved_at: string | null
  first_response_seconds: number | null
  resolution_seconds: number | null
  open_duration_seconds: number | null
  first_response_breached: boolean
  resolution_breached: boolean
}

export interface SessionListResponse {
  sessions: SessionListItem[]
  total_sessions: number
  resolved_sessions: number
  open_sessions: number
}

export async function fetchSubjectSessions(
  subjectId: string,
  tenantId?: string
): Promise<SessionListResponse> {
  // Use the admin subjects endpoint which includes SLA + session data
  let path = `/admin/subjects/${encodeURIComponent(subjectId)}/sla`
  if (tenantId) path += `?tenant_id=${encodeURIComponent(tenantId)}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return {
    sessions: data.sessions ?? [],
    total_sessions: data.total_sessions ?? 0,
    resolved_sessions: data.resolved_sessions ?? 0,
    open_sessions: data.open_sessions ?? 0,
  }
}

// ─── Memory Evolution / Related Memories ─────────────────────────────────────

export interface RelatedMemoryItem {
  id: string
  kind: string
  content: string
  summary: string
  confidence: number
  status: string
  created_at: string
  relationship: 'supersedes' | 'superseded_by' | 'sibling'
}

/**
 * Convert a RelatedMemoryItem to a MemoryListItem for use in modals.
 * Note: source_episode_ids and valid_from/valid_to are not available from related memory data.
 */
export function relatedMemoryToListItem(related: RelatedMemoryItem): MemoryListItem {
  return {
    id: related.id,
    kind: related.kind,
    content: related.content,
    summary: related.summary,
    confidence: related.confidence,
    status: related.status,
    source_episode_ids: [], // Not available from related endpoint
    valid_from: related.created_at, // Use created_at as approximation
    valid_to: null,
    created_at: related.created_at,
  }
}

export interface MemoryEvolutionResponse {
  memory_id: string
  status: string
  created_at: string
  superseding_memory: RelatedMemoryItem | null
  superseded_memories: RelatedMemoryItem[]
  sibling_memories: RelatedMemoryItem[]
  source_episode_count: number
}

export async function fetchMemoryRelated(
  subjectId: string,
  memoryId: string,
  tenantId?: string
): Promise<MemoryEvolutionResponse> {
  const query = new URLSearchParams()
  if (tenantId) query.set('tenant_id', tenantId)

  const queryStr = query.toString()
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/memories/${encodeURIComponent(memoryId)}/related${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Session Timeline ────────────────────────────────────────────────────────

export interface TimelineEpisodeEvent {
  event_type: 'episode'
  id: string
  source: string
  type: string
  payload: Record<string, unknown>
  metadata: Record<string, unknown>
  provenance: Record<string, unknown>
  created_at: string
  citing_memory_count: number
}

export interface TimelineResolutionEvent {
  event_type: 'resolution'
  resolved_at: string
  status: string
}

export type TimelineEvent = TimelineEpisodeEvent | TimelineResolutionEvent

export interface SessionTimelineResponse {
  session_id: string
  status: string
  first_message_at: string | null
  first_response_at: string | null
  resolved_at: string | null
  first_response_seconds: number | null
  resolution_seconds: number | null
  first_response_breached: boolean
  resolution_breached: boolean
  episode_count: number
  events: TimelineEvent[]
}

export async function fetchSessionTimeline(
  subjectId: string,
  sessionId: string,
  tenantId?: string
): Promise<SessionTimelineResponse> {
  const query = new URLSearchParams()
  if (tenantId) query.set('tenant_id', tenantId)

  const queryStr = query.toString()
  const path = `/admin/subjects/${encodeURIComponent(subjectId)}/sessions/${encodeURIComponent(sessionId)}/timeline${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ─── Compile Jobs ────────────────────────────────────────────────────────────

export interface CompileJobListItem {
  job_id: string
  subject_id: string
  tenant_id: string | null
  status: string
  memories_created: number
  error: string | null
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}

export interface CompileJobListResponse {
  jobs: CompileJobListItem[]
  total: number
  limit: number
  offset: number
}

export interface CompileJobListParams {
  status?: string
  subject_id?: string
  tenant_id?: string
  limit?: number
  offset?: number
}

export async function fetchCompileJobs(
  params: CompileJobListParams = {}
): Promise<CompileJobListResponse> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.subject_id) query.set('subject_id', params.subject_id)
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/jobs${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface PurgeCompileJobsParams {
  status?: string
  subject_id?: string
  tenant_id?: string
}

/** Bulk-delete terminal compile jobs matching the filter. Server requires at
 *  least one filter and rejects non-terminal statuses. */
export async function purgeCompileJobs(
  params: PurgeCompileJobsParams
): Promise<{ deleted: number }> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.subject_id) query.set('subject_id', params.subject_id)
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  const queryStr = query.toString()
  const path = `/admin/jobs${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Webhook Events ──────────────────────────────────────────────────────────

export interface WebhookEventListItem {
  id: string
  event: string
  status: string
  attempts: number
  max_attempts: number
  last_attempt_at: string | null
  next_attempt_at: string | null
  last_error: string | null
  http_status: number | null
  created_at: string
  delivered_at: string | null
  tenant_id: string | null
}

export interface WebhookEventListResponse {
  events: WebhookEventListItem[]
  total: number
  limit: number
  offset: number
}

export interface WebhookEventListParams {
  status?: string
  event_type?: string
  tenant_id?: string
  limit?: number
  offset?: number
}

export async function fetchWebhookEvents(
  params: WebhookEventListParams = {}
): Promise<WebhookEventListResponse> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.event_type) query.set('event_type', params.event_type)
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  if (params.limit !== undefined) query.set('limit', String(params.limit))
  if (params.offset !== undefined) query.set('offset', String(params.offset))

  const queryStr = query.toString()
  const path = `/admin/webhooks${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export interface PurgeWebhookEventsParams {
  status?: string
  event_type?: string
  tenant_id?: string
}

/** Bulk-delete terminal webhook events matching the filter. Server requires
 *  at least one filter and rejects non-terminal statuses. */
export async function purgeWebhookEvents(
  params: PurgeWebhookEventsParams
): Promise<{ deleted: number }> {
  const query = new URLSearchParams()
  if (params.status) query.set('status', params.status)
  if (params.event_type) query.set('event_type', params.event_type)
  if (params.tenant_id) query.set('tenant_id', params.tenant_id)
  const queryStr = query.toString()
  const path = `/admin/webhooks${queryStr ? `?${queryStr}` : ''}`
  const res = await fetch(adminUrl(path), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Subject Deletion (single + filtered bulk) ───────────────────────────────

export interface DeleteSubjectResult {
  subject_id: string
  episodes_deleted: number
  memories_deleted: number
}

export interface BulkDeleteFilter {
  subject_id_prefix?: string
  older_than_days?: number
  tenant_id?: string
  /** Explicit "match every subject" opt-in. Required by the backend when
   *  no other selector is set. The UI gates this behind a type-to-confirm
   *  phrase so it cannot be triggered accidentally. */
  match_all?: boolean
}

export interface BulkDeleteSample {
  subject_id: string
  tenant_id: string | null
  episode_count: number
  memory_count: number
  last_episode_at: string | null
}

export interface BulkDeletePreview {
  matched: number
  sample: BulkDeleteSample[]
  total_episodes: number
  total_memories: number
}

export interface BulkDeleteResult {
  deleted_subjects: number
  deleted_episodes: number
  deleted_memories: number
  failed: string[]
}

async function readError(res: Response): Promise<string> {
  try {
    const data = await res.json()
    return data?.error?.message ?? data?.detail ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

/** Delete a single subject (cascades to all its episodes + memories). Irreversible. */
export async function deleteSubject(
  subjectId: string,
  tenantId?: string
): Promise<DeleteSubjectResult> {
  let path = `/admin/subjects/${encodeURIComponent(subjectId)}`
  if (tenantId) path += `?tenant_id=${encodeURIComponent(tenantId)}`
  const res = await fetch(adminUrl(path), { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

/** Preview the subjects a filter would match — read-only, safe to run repeatedly. */
export async function previewBulkDelete(filter: BulkDeleteFilter): Promise<BulkDeletePreview> {
  const res = await fetch(adminUrl('/admin/subjects/preview-delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(filter),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

/**
 * Commit a previously previewed bulk delete. The server refuses with 409 if
 * the matched count has drifted since the preview — re-preview and retry.
 */
export async function commitBulkDelete(
  filter: BulkDeleteFilter,
  expectedCount: number
): Promise<BulkDeleteResult> {
  const res = await fetch(adminUrl('/admin/subjects/bulk-delete'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...filter, expected_count: expectedCount, confirm: true }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}


// ─── Memory portability (vendor-neutral) ─────────────────────────────────────
//
// Six admin endpoints, all under /admin/memory/*. Both export and import
// transmit plaintext JSON over the authenticated /api/proxy session — the
// admin client encrypts/decrypts the .swmem container locally so the
// passphrase never touches the server. See lib/swmem.ts for the crypto.

export type StarterPackKind = 'support_docs' | 'demo_agent'
export type ConflictStrategy = 'create_copy' | 'merge' | 'cancel'
export type MemoryScope =
  | 'episodes'
  | 'memories'
  | 'episodes_and_memories'
  | 'episodes_memories_sources'

export interface StarterPack {
  pack_id: string
  kind: StarterPackKind | null
  display_name: string
  description: string
  version: string
  created_at: string
  subject_id_suggestion: string
  episode_count: number
  memory_count: number
  source_count: number
  tags: string[]
}

export interface StarterPackImportResult {
  pack_id: string
  target_subject_id: string
  imported_episodes: number
  imported_memories: number
  imported_sources: number
  conflict_strategy: ConflictStrategy
  imported_at: string
}

export interface SupportReseedResult {
  subject_id: string
  pack_id: string
  pack_version: string
  installed_version: string | null
  /** The version that was on the live subject before this call. `null` for
   *  fresh installs (subject was empty or unversioned). */
  previous_version?: string | null
  imported_episodes: number
  imported_memories: number
  /** Operator-added rows preserved by the selective purge, if any. */
  operator_episodes_preserved?: number
  operator_memories_preserved?: number
  reseeded_at: string | null
  reason: string | null
  /** False when the call was a no-op (live subject already on bundled
   *  version and `force` was not set). */
  updated: boolean
  /** One of: `already_current` | `seeded` | `auto_updated` | `force_reseeded`. */
  outcome: string
}

export interface SupportSubjectState {
  subject_id: string
  pack_id: string
  /** Version of the pack baked into the running API image. */
  bundled_version: string
  /** Version currently installed in the live subject (read from row metadata).
   *  Null when the subject is empty or only contains unversioned rows. */
  installed_version: string | null
  /** True when bundled_version === installed_version. */
  is_up_to_date: boolean
  total_episode_count: number
  total_memory_count: number
  /** Rows whose metadata identifies them as belonging to the support pack —
   *  the only rows the auto-update path is allowed to delete. */
  owned_episode_count: number
  owned_memory_count: number
  /** Rows added by an operator alongside the pack content. Surface these
   *  in the UI so the operator knows their additions are safe across
   *  auto-updates. */
  operator_episode_count: number
  operator_memory_count: number
  last_reseed: {
    imported_at: string | null
    reason: string | null
    version: string | null
  }
}

export interface CloneResult {
  status: 'cloned'
  source_subject_id: string
  target_subject_id: string
  target_display_name: string | null
  clone_scope: MemoryScope
  episode_count: number
  memory_count: number
  /** Sources/citations are not yet first-class cloneable records — the
   *  backend always returns 0 here. The field is kept on the wire so the
   *  shape stays stable when sources land later. */
  source_count: number
  cloned_at: string
}

export interface MemoryExportPayload {
  format: 'statewave-memory-payload'
  format_version: number
  export_id: string
  exported_at: string
  export_scope: MemoryScope
  subjects: Array<Record<string, unknown>>
  episodes: Array<Record<string, unknown>>
  memories: Array<Record<string, unknown>>
  sources: Array<Record<string, unknown>>
  metadata: Record<string, unknown>
}

export interface MemoryImportResult {
  imported_at: string
  export_id: string | null
  conflict_strategy: ConflictStrategy
  subject_id_map: Record<string, string>
  imported_subjects: string[]
  imported_episodes: number
  imported_memories: number
  imported_sources: number
}

export async function listStarterPacks(): Promise<StarterPack[]> {
  const res = await fetch(adminUrl('/admin/memory/starter-packs'))
  if (!res.ok) throw new Error(await readError(res))
  const data = await res.json()
  return data.packs ?? []
}

export interface ImportStarterPackOptions {
  pack_id: string
  target_subject_id?: string
  target_display_name?: string
  target_tenant_id?: string
  conflict_strategy?: ConflictStrategy
}

export async function importStarterPack(
  opts: ImportStarterPackOptions,
): Promise<StarterPackImportResult> {
  const res = await fetch(adminUrl('/admin/memory/starter-packs/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function reseedStatewaveSupport(
  reason?: string,
  options: { force?: boolean } = {},
): Promise<SupportReseedResult> {
  const body: { reason?: string; force?: boolean } = {}
  if (reason) body.reason = reason
  if (options.force) body.force = true
  const res = await fetch(adminUrl('/admin/memory/support/reseed'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchSupportSubjectState(): Promise<SupportSubjectState> {
  const res = await fetch(adminUrl('/admin/memory/support/state'))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export interface CloneSubjectOptions {
  source_subject_id: string
  target_subject_id?: string
  target_display_name?: string
  target_tenant_id?: string
  clone_scope?: MemoryScope
}

export async function cloneSubject(opts: CloneSubjectOptions): Promise<CloneResult> {
  const res = await fetch(adminUrl('/admin/memory/clone'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export interface ExportSubjectsOptions {
  subject_ids: string[]
  tenant_id?: string
  export_scope?: MemoryScope
}

/**
 * Returns the PLAINTEXT export payload. The admin client is expected to
 * encrypt this payload immediately via lib/swmem.ts before saving it to
 * disk as a .swmem file. The passphrase never touches this function.
 */
export async function exportMemoryPayload(
  opts: ExportSubjectsOptions,
): Promise<MemoryExportPayload> {
  const res = await fetch(adminUrl('/admin/memory/export'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export interface ImportMemoryOptions {
  payload: MemoryExportPayload
  target_tenant_id?: string
  conflict_strategy?: ConflictStrategy
}

/**
 * Send a previously decrypted memory payload to the backend. The .swmem
 * container is opened locally (lib/swmem.ts), the passphrase is dropped on
 * the floor, and only the decrypted JSON payload travels to the server.
 */
export async function importMemoryPayload(
  opts: ImportMemoryOptions,
): Promise<MemoryImportResult> {
  const res = await fetch(adminUrl('/admin/memory/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── First-admin-run smoke check ─────────────────────────────────────────────
//
// The admin server runs a small ingest/compile/webhook flow against the
// connected backend so a fresh install can self-verify wiring. Both calls
// go through the auth-gated `/api/admin/smoke/*` endpoints — never directly
// to the Statewave backend — so the X-API-Key never crosses to the browser.

export type SmokeOverallStatus =
  | 'never_run'
  | 'running'
  | 'success'
  | 'partial'
  | 'failed'
  | 'disabled'

export type SmokeStepStatus = 'ok' | 'failed' | 'skipped'

export type SmokeWebhookState =
  | 'configured_delivered'
  | 'configured_pending'
  | 'configured_failed'
  | 'not_configured'
  | 'unknown'

export interface SmokeBackendStep {
  status: SmokeStepStatus
  detail: string
  readiness?: string
}

export interface SmokeDemoJobStep {
  status: SmokeStepStatus
  detail: string
  subject_id: string
  episode_id: string | null
  job_id: string | null
  memories_created: number | null
  job_mode: 'sync' | 'async' | null
  subject_visible: boolean
}

export interface SmokeDemoWebhookStep {
  status: SmokeStepStatus
  detail: string
  state: SmokeWebhookState
  total_before: number | null
  total_after: number | null
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
  backend: SmokeBackendStep
  demo_job: SmokeDemoJobStep
  demo_webhook: SmokeDemoWebhookStep
  error: string | null
}

export interface SmokeStatus {
  enabled: boolean
  has_run: boolean
  is_running: boolean
  subject_id: string
  last_result: SmokeResult | null
}

export async function fetchSmokeStatus(): Promise<SmokeStatus> {
  const res = await fetch('/api/admin/smoke/status', {
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function runSmokeCheck(): Promise<SmokeResult> {
  const res = await fetch('/api/admin/smoke/run', {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

// ─── Self-Healing Eval ────────────────────────────────────────────────────
//
// Mirrors `server/self-healing-eval/types.ts`. The shapes are duplicated
// (rather than imported) because the client bundle must not pull in
// `server/*` modules — those depend on `node:*`.

export type EvalLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type EvalMode = 'smoke' | 'developer' | 'full'
export type EvalVerdict = 'pass' | 'partial' | 'fail'
export type EvalRunStatus = 'idle' | 'running' | 'pass' | 'partial' | 'fail' | 'error'

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
  latest: {
    run_id: string
    status: EvalRunStatus
    finished_at: string | null
    overall_score: number
    mode: EvalMode
  } | null
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

export interface EvalConversationTurn {
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
  }
  evaluation: {
    correctness_score: number
    grounding_score: number
    completeness_score: number
    clarity_score: number
    safety_score: number
    overall_score: number
    verdict: EvalVerdict
    reason: string
    missing_points: string[]
    hallucination_risks: string[]
    recommended_fix: string
    likely_root_cause: string[]
  }
}

export interface EvalLevelSummary {
  name: string
  turns_total: number
  passes: number
  partials: number
  fails: number
  average_score: number
}

export interface EvalRecommendation {
  priority: 'high' | 'medium' | 'low'
  area: string
  problem: string
  recommended_change: string
  acceptance_criteria: string[]
}

export interface EvalAgentPromptOverrideMetadata {
  used: boolean
  delivery: 'not_used' | 'sent' | 'sent_unconfirmed' | 'confirmed'
  length: number
  hash: string
  preview: string
}

export interface EvalComparisonResult {
  baseline_run_id: string
  candidate_run_id: string
  baseline_score: number
  candidate_score: number
  score_delta: number
  pass_delta: number
  partial_delta: number
  fail_delta: number
  root_cause_delta: Record<string, { before: number; after: number; delta: number }>
  level_delta: Record<string, { before_avg: number; after_avg: number; delta: number }>
  improved_turns: string[]
  regressed_turns: string[]
  unchanged_failed_turns: string[]
}

export interface EvalReport {
  run_id: string
  started_at: string
  finished_at: string | null
  status: EvalRunStatus
  mode: EvalMode
  max_level: EvalLevel
  config: {
    statewave_api_url: string
    llm_provider: string
    llm_model: string
    demo_agent_configured: boolean
    webhook_configured: boolean
    agent_prompt_override: EvalAgentPromptOverrideMetadata
  }
  comparison?: EvalComparisonResult
  health: { status: 'pass' | 'fail'; details: Record<string, unknown> }
  webhook: {
    status: 'pass' | 'partial' | 'fail' | 'not_configured'
    trigger_attempted: boolean
    delivery_observed: boolean
    details: Record<string, unknown>
    recommended_fix: string
  }
  demo_job: { status: 'pass' | 'partial' | 'fail'; details: Record<string, unknown> }
  conversation: EvalConversationTurn[]
  summary: {
    turns_total: number
    passes: number
    partials: number
    fails: number
    overall_score: number
  }
  summary_by_level: Record<string, EvalLevelSummary>
  summary_by_category: Record<
    string,
    {
      turns_total: number
      passes: number
      partials: number
      fails: number
      average_score: number
    }
  >
  summary_by_root_cause: Record<string, { count: number; example_turn_ids: string[] }>
  recommendations: EvalRecommendation[]
  copilot_prompt: string
  progress: { completed: number; total: number; current_question_id: string | null }
  error: string | null
}

export interface EvalRunResponse {
  ok: boolean
  run_id: string | null
  status: EvalRunStatus
  estimated_llm_calls: number | null
  error: string | null
}

export interface EvalRunRequest {
  mode?: EvalMode
  max_level?: EvalLevel
  max_questions?: number
  include_code?: boolean
  include_topic_drift?: boolean
  /** When set, the demo agent is asked to answer FROM this subject's
   *  memory during the conversation phase. Smoke probes upstream are
   *  unaffected — they always use their own demo subject. */
  subject_id?: string
  /** Generated bank from /api/self-healing-eval/questions/generate. */
  override_questions?: EvalQuestionForUI[]
  /** Eval-only candidate agent system prompt — forwarded to the demo
   *  agent for this run only. Never persisted as production config. */
  system_prompt_override?: string
  /** Run id of an earlier eval run to diff against. When set, the
   *  finished report carries a `comparison` block. */
  baseline_run_id?: string
}

export async function fetchEvalStatus(): Promise<EvalStatus> {
  const res = await fetch('/api/self-healing-eval/status', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function startEvalRun(body: EvalRunRequest = {}): Promise<EvalRunResponse> {
  const res = await fetch('/api/self-healing-eval/run', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // 409 = run-in-progress, returns a structured payload too. Surface the
  // body so the UI can render the message instead of a generic error.
  if (res.status === 409 || res.ok || res.status === 202) {
    return res.json()
  }
  throw new Error(await readError(res))
}

export async function fetchLatestEvalReport(): Promise<EvalReport | null> {
  const res = await fetch('/api/self-healing-eval/report/latest', {
    credentials: 'same-origin',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchEvalReportMarkdown(): Promise<string | null> {
  const res = await fetch('/api/self-healing-eval/report/latest?format=markdown', {
    credentials: 'same-origin',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ─── Self-Healing Eval — LLM question generation ─────────────────────────

export interface EvalQuestionForUI {
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

export interface GenerateQuestionsRequest {
  topic: string
  grounding: string
  mode: EvalMode
  max_level?: EvalLevel
}

export interface GenerateQuestionsResponse {
  cache_key: string
  questions: EvalQuestionForUI[]
  warnings: string[]
}

export interface GenerateQuestionsError {
  error: string
  message?: string
  warnings?: string[]
}

export interface SuggestGroundingRequest {
  subject_id: string
  max_memories?: number
}

export interface SuggestGroundingResponse {
  topic: string
  grounding: string
  source: {
    subject_id: string
    memory_count: number
    sampled_memory_ids: string[]
    grounding_truncated: boolean
  }
}

export async function suggestGroundingFromSubject(
  body: SuggestGroundingRequest,
): Promise<SuggestGroundingResponse> {
  const res = await fetch('/api/self-healing-eval/grounding/suggest', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return res.json()
  let payload: { error?: string; message?: string } | null = null
  try {
    payload = await res.json()
  } catch {
    /* fall through */
  }
  const msg = payload?.message || payload?.error || `HTTP ${res.status}`
  const err = new Error(msg) as Error & { status: number }
  err.status = res.status
  throw err
}

export async function generateEvalQuestions(
  body: GenerateQuestionsRequest,
): Promise<GenerateQuestionsResponse> {
  const res = await fetch('/api/self-healing-eval/questions/generate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return res.json()
  let payload: GenerateQuestionsError | null = null
  try {
    payload = await res.json()
  } catch {
    /* fall through */
  }
  const msg = payload?.message || payload?.error || `HTTP ${res.status}`
  const err = new Error(msg) as Error & {
    status: number
    warnings?: string[]
  }
  err.status = res.status
  err.warnings = payload?.warnings
  throw err
}

// ─── Demo-pack persona health (read-only diagnostics) ────────────────────────
//
// Backs the /diagnostics "Demo personas" panel. Returns per-persona pack stats
// + retrieval probe results so an operator can see at a glance whether each
// demo pack is healthy. Cached server-side for 5 minutes; pass force=true to
// re-run the probes.

export type PersonaHealthStatus = 'pass' | 'warn' | 'fail' | 'error' | 'not_configured'

export interface PersonaProbeResult {
  query: string
  expected_substring: string
  rank: number | null
  pass: boolean
  top_memory_preview: string | null
}

export interface PersonaHealth {
  pack_id: string
  display_name: string
  version: string | null
  episode_count: number | null
  memory_count: number | null
  embedding_coverage: number | null
  probes: PersonaProbeResult[]
  status: PersonaHealthStatus
  error: string | null
}

export interface PersonaHealthReport {
  fetched_at: string
  personas: PersonaHealth[]
}

export async function fetchPersonaHealth(opts: { force?: boolean } = {}): Promise<PersonaHealthReport> {
  const url = opts.force
    ? '/api/admin/persona-health?force=true'
    : '/api/admin/persona-health'
  const res = await fetch(url, { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}


// ─── State-assembly receipts (#49) ───────────────────────────────────────────
//
// Read-only operator view of the receipts table. Receipts are emitted
// by the server's context/handoff assembly paths when the per-tenant
// config or per-request flag asks for them — see
// docs/state-assembly-receipts.md in the server repository for the
// full schema and emission policy. Admin can list across tenants; the
// per-tenant `/v1/receipts` endpoints are what applications should
// call from inside their app.

export interface ReceiptSelectedEntry {
  type: 'memory' | 'episode'
  memory_id?: string
  kind?: string
  valid_from?: string | null
  valid_to?: string | null
  supersession_status?: 'active' | 'superseded' | 'tombstoned'
  source_episode_ids?: string[]
  provenance_hash?: string
  fact_key?: string | null
  conflict_status?: 'none' | 'merged' | 'overridden' | 'unresolved'
  episode_id?: string
  source?: string
  event_type?: string
  occurred_at?: string | null
  rank: number
  score?: number | null
}

export interface ReceiptPolicyBlock {
  policy_bundle_hash: string | null
  filters_applied: unknown[]
  filters_skipped: unknown[]
  mode: 'log_only' | 'enforce'
}

export interface ReceiptOutputBlock {
  context_hash: string
  context_size_bytes: number
  canonicalization_version: number
  token_estimate: number
}

export interface Receipt {
  receipt_id: string
  parent_receipt_id: string | null
  mode: string
  query_id: string | null
  task_id: string | null
  tenant_id: string | null
  subject_id: string
  task: string
  as_of: string
  created_at: string
  selected_entries: ReceiptSelectedEntry[]
  policy: ReceiptPolicyBlock
  output: ReceiptOutputBlock
  region: string | null
  receipt_signature: string | null
}

export interface ReceiptListResponse {
  receipts: Receipt[]
  next_cursor: string | null
  limit: number
}

export interface FetchReceiptsParams {
  subject_id?: string
  tenant_id?: string
  since?: string
  until?: string
  cursor?: string
  limit?: number
}

export async function fetchReceipts(
  params: FetchReceiptsParams,
): Promise<ReceiptListResponse> {
  const qs = new URLSearchParams()
  if (params.subject_id) qs.set('subject_id', params.subject_id)
  if (params.tenant_id) qs.set('tenant_id', params.tenant_id)
  if (params.since) qs.set('since', params.since)
  if (params.until) qs.set('until', params.until)
  if (params.cursor) qs.set('cursor', params.cursor)
  qs.set('limit', String(params.limit ?? 50))
  const res = await fetch(adminUrl(`/admin/receipts?${qs}`))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchReceipt(receiptId: string): Promise<Receipt> {
  const res = await fetch(
    adminUrl(`/admin/receipts/${encodeURIComponent(receiptId)}`),
  )
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}


// ─── Sensitivity labels & policy bundles (#50) ───────────────────────────────
//
// The admin app surfaces three operator workflows on top of the
// server's policy layer: tag a memory (the only labeling path in v1
// — compiler/connector auto-tagging is a v2 follow-up), inspect the
// active policy bundle, and switch which bundle is active.

/**
 * Replace a memory's sensitivity_labels. The admin proxy forwards
 * the underlying PATCH /v1/memories/{id}/labels — the server
 * normalizes (dedup + lowercase + trim) so the canonical set comes
 * back in the response.
 */
export async function setMemoryLabels(
  memoryId: string,
  labels: string[],
  tenantId?: string,
): Promise<MemoryListItem> {
  // The admin proxy only forwards /admin/* paths, so labeling goes
  // through the server's admin shim (/admin/memories/{id}/labels)
  // which re-uses the same canonicalization + DB write path as
  // /v1/memories/{id}/labels.
  const adminPath = tenantId
    ? `/admin/memories/${encodeURIComponent(memoryId)}/labels?tenant_id=${encodeURIComponent(tenantId)}`
    : `/admin/memories/${encodeURIComponent(memoryId)}/labels`
  const res = await fetch(adminUrl(adminPath), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sensitivity_labels: labels }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}


export interface PolicyRuleSummary {
  id: string
  description: string
  when: Record<string, unknown>
  action: 'deny' | 'redact'
}

export interface PolicyBundleSummary {
  bundle_hash: string
  tenant_id: string | null
  active: boolean
  created_at: string
}

export interface PolicyBundleDetail extends PolicyBundleSummary {
  yaml_content: string
  metadata: Record<string, unknown>
  rules: PolicyRuleSummary[]
}

export interface ActivePolicyBundle {
  bundle_hash: string
  version: number
  rule_count: number
  metadata: Record<string, unknown>
  rules: PolicyRuleSummary[]
}

export async function fetchPolicyBundles(
  tenantId?: string,
): Promise<{ bundles: PolicyBundleSummary[] }> {
  const path = tenantId
    ? `/admin/policy/bundles?tenant_id=${encodeURIComponent(tenantId)}`
    : '/admin/policy/bundles'
  const res = await fetch(adminUrl(path))
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchPolicyBundle(
  bundleHash: string,
): Promise<PolicyBundleDetail> {
  const res = await fetch(
    adminUrl(`/admin/policy/bundles/${encodeURIComponent(bundleHash)}`),
  )
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function fetchActivePolicy(
  tenantId?: string,
): Promise<ActivePolicyBundle | null> {
  const path = tenantId
    ? `/admin/policy/active?tenant_id=${encodeURIComponent(tenantId)}`
    : '/admin/policy/active'
  const res = await fetch(adminUrl(path))
  if (res.status === 404) return null
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function uploadPolicyBundle(req: {
  yaml_content: string
  tenant_id?: string | null
  activate?: boolean
}): Promise<{ bundle_hash: string; rule_count: number; active: boolean }> {
  const res = await fetch(adminUrl('/admin/policy/bundles'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}

export async function activatePolicyBundle(
  bundleHash: string,
): Promise<{ bundle_hash: string; active: boolean }> {
  const res = await fetch(adminUrl('/admin/policy/activate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bundle_hash: bundleHash }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return res.json()
}
