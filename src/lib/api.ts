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
