import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { Badge, LoadingOverlay, EmptyState, InlineError } from '../components/ui'
import {
  fetchSessionTimeline,
  fetchCitingMemories,
  fetchSubjectDetail,
  type SessionTimelineResponse,
  type TimelineEpisodeEvent,
  type MemoryListItem,
} from '../lib/api'
import { EpisodeDetailModal } from '../components/EpisodeDetailModal'
import { MemoryDetailModal } from '../components/MemoryDetailModal'
import { SourceEpisodesModal } from '../components/SourceEpisodesModal'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatRelativeTime(timestamp: string, referenceTime: Date): string {
  const date = new Date(timestamp)
  const diffMs = date.getTime() - referenceTime.getTime()
  const diffSeconds = Math.abs(diffMs / 1000)

  if (diffSeconds < 60) return `+${Math.round(diffSeconds)}s`
  if (diffSeconds < 3600) return `+${Math.round(diffSeconds / 60)}m`
  const hours = Math.floor(diffSeconds / 3600)
  const minutes = Math.round((diffSeconds % 3600) / 60)
  return minutes > 0 ? `+${hours}h ${minutes}m` : `+${hours}h`
}

function getSourceLane(source: string): 'user' | 'agent' | 'system' {
  const userSources = ['user', 'chat', 'support-chat', 'support_chat', 'customer', 'manual_input']
  const agentSources = ['assistant', 'agent', 'support', 'staff']

  if (userSources.includes(source.toLowerCase())) return 'user'
  if (agentSources.includes(source.toLowerCase())) return 'agent'
  return 'system'
}

const laneConfig = {
  user: { color: 'bg-blue-500', label: 'User', dotClass: 'bg-blue-500', borderClass: 'border-blue-500/30' },
  agent: { color: 'bg-green-500', label: 'Agent', dotClass: 'bg-green-500', borderClass: 'border-green-500/30' },
  system: { color: 'bg-gray-400', label: 'System', dotClass: 'bg-gray-400', borderClass: 'border-gray-400/30' },
}

// ─── Inline Citing Memories ──────────────────────────────────────────────────

interface InlineCitingMemoriesProps {
  episodeId: string
  subjectId: string
  tenantId: string | null
  onMemoryClick: (memory: MemoryListItem) => void
}

function InlineCitingMemories({ episodeId, subjectId, tenantId, onMemoryClick }: InlineCitingMemoriesProps) {
  const [memories, setMemories] = useState<MemoryListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchCitingMemories(subjectId, episodeId, {
          tenant_id: tenantId ?? undefined,
          limit: 20,
        })
        if (!cancelled) setMemories(result.memories)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [episodeId, subjectId, tenantId])

  if (loading) {
    return (
      <div className="mt-3 ml-6 p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/30">
        <p className="text-xs text-theme-muted">Loading memories…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-3 ml-6 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
        <p className="text-xs text-red-400">{error}</p>
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="mt-3 ml-6 p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/30">
        <p className="text-xs text-theme-muted">No citing memories found</p>
      </div>
    )
  }

  return (
    <div className="mt-3 ml-6 space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-theme-muted font-medium mb-2">
        Derived Memories
      </p>
      {memories.map((memory) => (
        <button
          key={memory.id}
          onClick={() => onMemoryClick(memory)}
          className="w-full text-left p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/30 hover:border-accent/40 hover:bg-accent/5 transition-all group"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
              {memory.kind}
            </Badge>
            {memory.status === 'superseded' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                superseded
              </span>
            )}
            <span className="text-[10px] text-theme-muted ml-auto group-hover:text-accent transition-colors">
              View details →
            </span>
          </div>
          <p className="text-xs text-theme-secondary line-clamp-2">{memory.content}</p>
        </button>
      ))}
    </div>
  )
}

// ─── Timeline Event Card ─────────────────────────────────────────────────────

interface TimelineEventProps {
  event: TimelineEpisodeEvent
  relativeTime: string
  isExpanded: boolean
  onToggleExpand: () => void
  onEpisodeClick: () => void
  onMemoryClick: (memory: MemoryListItem) => void
  subjectId: string
  tenantId: string | null
}

function TimelineEvent({
  event,
  relativeTime,
  isExpanded,
  onToggleExpand,
  onEpisodeClick,
  onMemoryClick,
  subjectId,
  tenantId,
}: TimelineEventProps) {
  const lane = getSourceLane(event.source)
  const config = laneConfig[lane]

  const payloadPreview = (() => {
    if (typeof event.payload === 'object' && event.payload !== null) {
      const p = event.payload as Record<string, unknown>
      const preview = String(
        p.text ?? p.message ?? p.content ?? p.query ?? JSON.stringify(event.payload).slice(0, 200)
      )
      return preview.length > 200 ? preview.slice(0, 200) + '…' : preview
    }
    return String(event.payload)
  })()

  return (
    <div className="relative pl-8 pb-8 group">
      {/* Timeline line */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-theme-border/50 group-last:hidden" />

      {/* Timeline dot */}
      <div
        className={`absolute left-0 top-1.5 w-6 h-6 rounded-full border-2 border-[var(--theme-bg)] ${config.dotClass} flex items-center justify-center`}
      >
        <div className="w-2 h-2 rounded-full bg-white/80" />
      </div>

      {/* Event card */}
      <div
        className={`rounded-xl border bg-[var(--theme-card-bg)] overflow-hidden transition-all ${
          isExpanded ? 'border-accent/40 shadow-lg shadow-accent/5' : 'border-theme-border hover:border-theme-border-hover'
        }`}
      >
        {/* Card header - clickable for episode details */}
        <button
          onClick={onEpisodeClick}
          className="w-full text-left p-4 hover:bg-[var(--theme-surface-1)] transition-colors"
        >
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge>{event.type}</Badge>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${config.color}/10 text-theme-secondary`}>
                {config.label}
              </span>
              <span className="text-[10px] text-theme-muted">· {event.source}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-[10px] text-theme-muted tabular-nums">{relativeTime}</span>
            </div>
          </div>

          <p className="text-sm text-theme-primary leading-relaxed">{payloadPreview}</p>

          <div className="mt-2 text-[10px] text-theme-muted">
            {new Date(event.created_at).toLocaleTimeString()}
          </div>
        </button>

        {/* Memory citation indicator */}
        {event.citing_memory_count > 0 && (
          <div className="border-t border-theme-border/50">
            <button
              onClick={onToggleExpand}
              className={`w-full px-4 py-2 flex items-center justify-between text-xs transition-colors ${
                isExpanded
                  ? 'bg-accent/10 text-accent'
                  : 'hover:bg-[var(--theme-surface-1)] text-theme-muted hover:text-theme-secondary'
              }`}
            >
              <span className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                {event.citing_memory_count} derived {event.citing_memory_count === 1 ? 'memory' : 'memories'}
              </span>
              <svg
                className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        )}

        {/* Expanded memories */}
        {isExpanded && event.citing_memory_count > 0 && (
          <div className="p-4 pt-0 bg-[var(--theme-surface-1)]/50">
            <InlineCitingMemories
              episodeId={event.id}
              subjectId={subjectId}
              tenantId={tenantId}
              onMemoryClick={onMemoryClick}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Resolution Marker ───────────────────────────────────────────────────────

function ResolutionMarker({ resolvedAt }: { resolvedAt: string }) {
  return (
    <div className="relative pl-8 pb-8">
      {/* Checkmark dot */}
      <div className="absolute left-0 top-1.5 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <div className="flex items-center gap-4 py-3">
        <div className="flex-1 border-t border-dashed border-green-500/40" />
        <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30">
          <span className="text-xs font-medium text-green-400">Session Resolved</span>
          <span className="text-xs text-green-400/70">
            {new Date(resolvedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex-1 border-t border-dashed border-green-500/40" />
      </div>
    </div>
  )
}

// ─── Main Page Component ─────────────────────────────────────────────────────

export function SessionTimelinePage() {
  const { subjectId, sessionId } = useParams<{ subjectId: string; sessionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const tenantId = searchParams.get('tenant_id')
  
  // Read expanded param from URL - this is stable and won't cause re-render issues
  // because we only use it for initial state
  const expandedParam = searchParams.get('expanded')

  const [timeline, setTimeline] = useState<SessionTimelineResponse | null>(null)
  const [subjectName, setSubjectName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Initialize expanded state from URL param
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(() => {
    return expandedParam 
      ? new Set(expandedParam.split(',').filter(Boolean))
      : new Set<string>()
  })

  // Modal states (ephemeral - not persisted to URL)
  const [selectedEpisode, setSelectedEpisode] = useState<TimelineEpisodeEvent | null>(null)
  const [selectedMemory, setSelectedMemory] = useState<MemoryListItem | null>(null)
  const [sourceEpisodesMemory, setSourceEpisodesMemory] = useState<MemoryListItem | null>(null)
  const [navigationContext, setNavigationContext] = useState<string | null>(null)

  // Copy feedback states
  const [copiedId, setCopiedId] = useState(false)
  const [copiedLink, setCopiedLink] = useState(false)

  // Update URL when expanded state changes
  const updateExpandedInUrl = useCallback((newExpanded: Set<string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      if (newExpanded.size > 0) {
        next.set('expanded', Array.from(newExpanded).join(','))
      } else {
        next.delete('expanded')
      }
      return next
    }, { replace: true })
  }, [setSearchParams])

  const loadTimeline = useCallback(async () => {
    if (!subjectId || !sessionId) return

    setLoading(true)
    setError(null)

    try {
      const [timelineResult, subjectResult] = await Promise.all([
        fetchSessionTimeline(subjectId, sessionId, tenantId ?? undefined),
        fetchSubjectDetail(subjectId, tenantId ?? undefined).catch(() => null),
      ])
      setTimeline(timelineResult)
      setSubjectName(subjectResult?.subject_id ?? subjectId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline')
    } finally {
      setLoading(false)
    }
  }, [subjectId, sessionId, tenantId])

  useEffect(() => {
    // Initial data fetch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTimeline()
  }, [loadTimeline])

  const toggleExpand = useCallback((episodeId: string) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev)
      if (next.has(episodeId)) {
        next.delete(episodeId)
      } else {
        next.add(episodeId)
      }
      // Update URL with new expanded state
      updateExpandedInUrl(next)
      return next
    })
  }, [updateExpandedInUrl])

  const firstMessageTime = timeline?.first_message_at
    ? new Date(timeline.first_message_at)
    : timeline?.events?.[0]?.event_type === 'episode'
      ? new Date((timeline.events[0] as TimelineEpisodeEvent).created_at)
      : null

  // Convert timeline episode to EpisodeListItem format for modal
  const toEpisodeListItem = (ep: TimelineEpisodeEvent) => ({
    id: ep.id,
    session_id: sessionId!,
    source: ep.source,
    type: ep.type,
    payload: ep.payload,
    metadata: ep.metadata,
    provenance: ep.provenance,
    created_at: ep.created_at,
  })

  // Build back URL with tab=sessions preserved
  const backToSubjectUrl = `/subjects/${subjectId}?tab=sessions${tenantId ? `&tenant_id=${tenantId}` : ''}`
  // Copy handlers
  const handleCopySessionId = async () => {
    if (!sessionId) return
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopiedId(true)
      setTimeout(() => setCopiedId(false), 2000)
    } catch {
      // Fallback for browsers without clipboard API
      console.warn('Clipboard API not available')
    }
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    } catch {
      console.warn('Clipboard API not available')
    }
  }

  // Build URLs
  const viewEpisodesUrl = `/subjects/${subjectId}?tab=episodes&session=${sessionId}${tenantId ? `&tenant_id=${tenantId}` : ''}`

  return (
    <div className="min-h-screen bg-[var(--theme-bg)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[var(--theme-bg)]/95 backdrop-blur border-b border-theme-border">
        <div className="max-w-4xl mx-auto px-6 py-4">
          {/* Breadcrumb with back arrow */}
          <nav className="flex items-center gap-2 text-xs mb-3">
            <Link
              to={backToSubjectUrl}
              className="text-theme-muted hover:text-accent transition-colors p-1 -ml-1 rounded hover:bg-accent/10"
              title="Back to Sessions"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <Link
              to={backToSubjectUrl}
              className="text-theme-muted hover:text-accent transition-colors truncate max-w-[200px]"
              title={subjectName ?? subjectId}
            >
              {subjectName ?? subjectId}
            </Link>
            <span className="text-theme-muted/50">/</span>
            <Link
              to={backToSubjectUrl}
              className="text-theme-muted hover:text-accent transition-colors"
            >
              Sessions
            </Link>
            <span className="text-theme-muted/50">/</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-theme-secondary font-mono truncate max-w-[180px]" title={sessionId}>
                {sessionId}
              </span>
              <button
                onClick={handleCopySessionId}
                className="text-theme-muted hover:text-accent transition-colors p-0.5 rounded hover:bg-accent/10"
                title="Copy session ID"
                aria-label="Copy session ID to clipboard"
              >
                {copiedId ? (
                  <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                )}
              </button>
            </span>
          </nav>

          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold text-theme-primary">Session Timeline</h1>
            </div>

            <div className="flex items-center gap-2">
              {/* Quick Actions */}
              <button
                onClick={handleCopyLink}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-theme-muted hover:text-theme-secondary border border-theme-border rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors"
                title="Copy link to this timeline"
                aria-label="Copy link to this timeline"
              >
                {copiedLink ? (
                  <>
                    <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    Copy Link
                  </>
                )}
              </button>

              <Link
                to={viewEpisodesUrl}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-theme-muted hover:text-theme-secondary border border-theme-border rounded-lg hover:bg-[var(--theme-surface-1)] transition-colors"
                title="View episodes for this session"
                aria-label="View episodes for this session"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                View Episodes
              </Link>

              {/* Status Badge */}
              {timeline && (
                <Badge variant={timeline.status === 'resolved' ? 'success' : 'muted'}>
                  {timeline.status}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Loading */}
        {loading && (
          <div className="relative py-20">
            <LoadingOverlay message="Loading timeline…" />
          </div>
        )}

        {/* Error */}
        {error && <InlineError message={error} onRetry={loadTimeline} />}

        {/* Session Stats */}
        {!loading && !error && timeline && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 p-4 rounded-xl bg-[var(--theme-card-bg)] border border-theme-border">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1">Episodes</p>
              <p className="text-lg font-semibold text-theme-primary">{timeline.episode_count}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1">First Response</p>
              <p className={`text-lg font-semibold ${timeline.first_response_breached ? 'text-red-400' : 'text-theme-primary'}`}>
                {timeline.first_response_seconds != null ? formatDuration(timeline.first_response_seconds) : '—'}
                {timeline.first_response_breached && ' ⚠'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1">Resolution Time</p>
              <p className={`text-lg font-semibold ${timeline.resolution_breached ? 'text-red-400' : 'text-theme-primary'}`}>
                {timeline.resolution_seconds != null ? formatDuration(timeline.resolution_seconds) : '—'}
                {timeline.resolution_breached && ' ⚠'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-theme-muted mb-1">Started</p>
              <p className="text-sm text-theme-primary">
                {timeline.first_message_at ? new Date(timeline.first_message_at).toLocaleString() : '—'}
              </p>
            </div>
          </div>
        )}

        {/* Lane Legend */}
        {!loading && !error && timeline && timeline.events.length > 0 && (
          <div className="flex items-center gap-6 mb-6 text-xs text-theme-muted">
            {Object.entries(laneConfig).map(([key, config]) => (
              <span key={key} className="flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${config.dotClass}`} />
                {config.label}
              </span>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && timeline && timeline.events.length === 0 && (
          <EmptyState title="No events" description="No episodes found for this session" />
        )}

        {/* Timeline */}
        {!loading && !error && timeline && timeline.events.length > 0 && (
          <div className="relative">
            {timeline.events.map((event, index) => {
              if (event.event_type === 'resolution') {
                return <ResolutionMarker key={`resolution-${index}`} resolvedAt={event.resolved_at} />
              }

              const ep = event as TimelineEpisodeEvent
              const relativeTime = firstMessageTime ? formatRelativeTime(ep.created_at, firstMessageTime) : ''

              return (
                <TimelineEvent
                  key={ep.id}
                  event={ep}
                  relativeTime={relativeTime}
                  isExpanded={expandedEpisodes.has(ep.id)}
                  onToggleExpand={() => toggleExpand(ep.id)}
                  onEpisodeClick={() => setSelectedEpisode(ep)}
                  onMemoryClick={setSelectedMemory}
                  subjectId={subjectId!}
                  tenantId={tenantId}
                />
              )
            })}

            {/* Truncation notice */}
            {timeline.episode_count > timeline.events.filter((e) => e.event_type === 'episode').length && (
              <div className="text-center py-4 text-xs text-theme-muted">
                Showing {timeline.events.filter((e) => e.event_type === 'episode').length} of {timeline.episode_count} episodes
              </div>
            )}
          </div>
        )}
      </div>

      {/* Episode Detail Modal */}
      {selectedEpisode && (
        <EpisodeDetailModal
          episode={toEpisodeListItem(selectedEpisode)}
          subjectId={subjectId!}
          tenantId={tenantId}
          onClose={() => {
            setSelectedEpisode(null)
            setNavigationContext(null)
          }}
        />
      )}

      {/* Memory Detail Modal */}
      {selectedMemory && (
        <MemoryDetailModal
          memory={selectedMemory}
          subjectId={subjectId!}
          tenantId={tenantId}
          fromContext={navigationContext ?? undefined}
          onClose={() => {
            setSelectedMemory(null)
            setNavigationContext(null)
          }}
          onViewSourceEpisodes={(memory) => {
            setSourceEpisodesMemory(memory)
          }}
          onNavigateToMemory={(memory) => {
            setSelectedMemory(memory)
            setNavigationContext(`Memory: ${selectedMemory.content.slice(0, 30)}...`)
          }}
        />
      )}

      {/* Source Episodes Modal */}
      {sourceEpisodesMemory && (
        <SourceEpisodesModal
          memory={sourceEpisodesMemory}
          subjectId={subjectId!}
          tenantId={tenantId}
          onClose={() => setSourceEpisodesMemory(null)}
          onEpisodeClick={(episode) => {
            // For timeline episodes, we need to find the matching TimelineEpisodeEvent
            const timelineEp = timeline?.events.find(
              (e): e is TimelineEpisodeEvent => e.event_type === 'episode' && e.id === episode.id
            )
            if (timelineEp) {
              setSelectedEpisode(timelineEp)
            }
            setNavigationContext(`Memory: ${sourceEpisodesMemory.content.slice(0, 30)}...`)
            setSourceEpisodesMemory(null)
          }}
        />
      )}
    </div>
  )
}
