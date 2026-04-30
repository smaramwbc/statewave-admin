import { useEffect, useState, useCallback } from 'react'
import { Modal, Badge, LoadingOverlay, EmptyState } from './ui'
import {
  fetchSessionTimeline,
  fetchCitingMemories,
  type SessionTimelineResponse,
  type TimelineEpisodeEvent,
  type EpisodeListItem,
  type MemoryListItem,
} from '../lib/api'

interface SessionTimelineModalProps {
  sessionId: string | null
  subjectId: string
  tenantId: string | null
  onClose: () => void
  onEpisodeClick?: (episode: EpisodeListItem) => void
  onMemoryClick?: (memory: MemoryListItem) => void
}

// Helper to format duration
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
}

// Helper to format relative time
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

// Determine the "lane" for visual alignment based on source
function getSourceLane(source: string): 'user' | 'agent' | 'system' {
  const userSources = ['user', 'chat', 'support-chat', 'support_chat', 'customer', 'manual_input']
  const agentSources = ['assistant', 'agent', 'support', 'staff']
  
  if (userSources.includes(source.toLowerCase())) return 'user'
  if (agentSources.includes(source.toLowerCase())) return 'agent'
  return 'system'
}

// Lane colors
const laneColors = {
  user: 'border-l-blue-400',
  agent: 'border-l-green-400',
  system: 'border-l-gray-400',
}

const laneLabels = {
  user: 'User',
  agent: 'Agent',
  system: 'System',
}

// ─── Inline Citing Memories Section ──────────────────────────────────────────

interface InlineCitingMemoriesProps {
  episodeId: string
  subjectId: string
  tenantId: string | null
  onMemoryClick?: (memory: MemoryListItem) => void
}

function InlineCitingMemories({
  episodeId,
  subjectId,
  tenantId,
  onMemoryClick,
}: InlineCitingMemoriesProps) {
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
        if (!cancelled) {
          setMemories(result.memories)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load memories')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    load()
    return () => { cancelled = true }
  }, [episodeId, subjectId, tenantId])

  if (loading) {
    return (
      <div className="mt-2 p-2 rounded bg-[var(--theme-surface-1)] border border-theme-border/30">
        <p className="text-[10px] text-theme-muted">Loading memories…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mt-2 p-2 rounded bg-red-500/5 border border-red-500/20">
        <p className="text-[10px] text-red-400">{error}</p>
      </div>
    )
  }

  if (memories.length === 0) {
    return (
      <div className="mt-2 p-2 rounded bg-[var(--theme-surface-1)] border border-theme-border/30">
        <p className="text-[10px] text-theme-muted">No citing memories found</p>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-1.5">
      {memories.map((memory) => (
        <div
          key={memory.id}
          className="p-2 rounded bg-[var(--theme-surface-1)] border border-theme-border/30 hover:border-theme-border transition-colors cursor-pointer"
          onClick={(e) => {
            e.stopPropagation()
            onMemoryClick?.(memory)
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <Badge variant={memory.status === 'active' ? 'success' : 'muted'}>
              {memory.kind}
            </Badge>
            {memory.status === 'superseded' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                superseded
              </span>
            )}
            <span className="text-[10px] text-theme-muted ml-auto">
              {new Date(memory.created_at).toLocaleTimeString()}
            </span>
          </div>
          <p className="text-[10px] text-theme-secondary line-clamp-2">{memory.content}</p>
        </div>
      ))}
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SessionTimelineModal({
  sessionId,
  subjectId,
  tenantId,
  onClose,
  onEpisodeClick,
  onMemoryClick,
}: SessionTimelineModalProps) {
  const [timeline, setTimeline] = useState<SessionTimelineResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Track which episodes have expanded citing memories
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set())

  const loadTimeline = useCallback(async () => {
    if (!sessionId) return

    setLoading(true)
    setError(null)

    try {
      const result = await fetchSessionTimeline(subjectId, sessionId, tenantId ?? undefined)
      setTimeline(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load timeline')
    } finally {
      setLoading(false)
    }
  }, [sessionId, subjectId, tenantId])

  useEffect(() => {
    if (sessionId) {
      // Initial data fetch
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadTimeline()
    } else {
      setTimeline(null)
      setError(null)
    }
  }, [sessionId, loadTimeline])

  if (!sessionId) return null

  // Convert timeline episode to EpisodeListItem for modal
  const toEpisodeListItem = (ep: TimelineEpisodeEvent): EpisodeListItem => ({
    id: ep.id,
    session_id: sessionId,
    source: ep.source,
    type: ep.type,
    payload: ep.payload,
    metadata: ep.metadata,
    provenance: ep.provenance,
    created_at: ep.created_at,
  })

  // Get the first message timestamp as reference for relative times
  const firstMessageTime = timeline?.first_message_at
    ? new Date(timeline.first_message_at)
    : timeline?.events?.[0]?.event_type === 'episode'
      ? new Date((timeline.events[0] as TimelineEpisodeEvent).created_at)
      : null

  return (
    <Modal
      open={!!sessionId}
      onClose={onClose}
      title="Session Timeline"
    >
      <div className="space-y-4">
        {/* Session Header */}
        {timeline && (
          <div className="p-3 rounded-lg bg-[var(--theme-surface-1)] border border-theme-border/50">
            <div className="flex items-center gap-3 mb-2">
              <Badge variant={timeline.status === 'resolved' ? 'success' : 'muted'}>
                {timeline.status}
              </Badge>
              <span className="text-xs font-mono text-theme-muted">{timeline.session_id}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
              <div>
                <p className="text-theme-muted mb-0.5">Episodes</p>
                <p className="text-theme-secondary font-medium">{timeline.episode_count}</p>
              </div>
              <div>
                <p className="text-theme-muted mb-0.5">First Response</p>
                <p className={`font-medium ${timeline.first_response_breached ? 'text-red-400' : 'text-theme-secondary'}`}>
                  {timeline.first_response_seconds != null
                    ? formatDuration(timeline.first_response_seconds)
                    : '—'}
                  {timeline.first_response_breached && ' ⚠'}
                </p>
              </div>
              <div>
                <p className="text-theme-muted mb-0.5">Resolution Time</p>
                <p className={`font-medium ${timeline.resolution_breached ? 'text-red-400' : 'text-theme-secondary'}`}>
                  {timeline.resolution_seconds != null
                    ? formatDuration(timeline.resolution_seconds)
                    : '—'}
                  {timeline.resolution_breached && ' ⚠'}
                </p>
              </div>
              <div>
                <p className="text-theme-muted mb-0.5">Started</p>
                <p className="text-theme-secondary">
                  {timeline.first_message_at
                    ? new Date(timeline.first_message_at).toLocaleString()
                    : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="relative py-8">
            <LoadingOverlay message="Loading timeline…" />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">{error}</p>
            <button
              onClick={loadTimeline}
              className="mt-2 text-xs text-red-400 underline underline-offset-2 hover:text-red-300"
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && timeline && timeline.events.length === 0 && (
          <EmptyState
            title="No events"
            description="No episodes found for this session"
          />
        )}

        {/* Lane Legend */}
        {!loading && !error && timeline && timeline.events.length > 0 && (
          <div className="flex items-center gap-4 text-[10px] text-theme-muted px-1">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              User
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              Agent
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              System
            </span>
          </div>
        )}

        {/* Timeline */}
        {!loading && !error && timeline && timeline.events.length > 0 && (
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {timeline.events.map((event, index) => {
              if (event.event_type === 'resolution') {
                return (
                  <div
                    key={`resolution-${index}`}
                    className="flex items-center gap-3 py-2"
                  >
                    <div className="flex-1 border-t border-dashed border-green-500/40" />
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30">
                      <svg
                        className="w-3.5 h-3.5 text-green-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                      <span className="text-[10px] font-medium text-green-400">
                        Resolved
                      </span>
                      <span className="text-[10px] text-green-400/70">
                        {new Date(event.resolved_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="flex-1 border-t border-dashed border-green-500/40" />
                  </div>
                )
              }

              // Episode event
              const ep = event as TimelineEpisodeEvent
              const lane = getSourceLane(ep.source)
              const relativeTime = firstMessageTime
                ? formatRelativeTime(ep.created_at, firstMessageTime)
                : ''
              const isExpanded = expandedEpisodes.has(ep.id)

              const toggleExpand = (e: React.MouseEvent) => {
                e.stopPropagation()
                setExpandedEpisodes(prev => {
                  const next = new Set(prev)
                  if (next.has(ep.id)) {
                    next.delete(ep.id)
                  } else {
                    next.add(ep.id)
                  }
                  return next
                })
              }

              return (
                <div
                  key={ep.id}
                  className={`
                    rounded-lg border border-theme-border bg-[var(--theme-card-bg)] 
                    p-3 border-l-2 ${laneColors[lane]}
                    ${isExpanded ? 'border-accent/30' : 'hover:border-theme-border-hover'}
                    transition-colors
                  `}
                >
                  <div 
                    className="cursor-pointer"
                    onClick={() => onEpisodeClick?.(toEpisodeListItem(ep))}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <Badge>{ep.type}</Badge>
                        <span className="text-[10px] text-theme-muted">{laneLabels[lane]}</span>
                        <span className="text-[10px] text-theme-muted">· {ep.source}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {ep.citing_memory_count > 0 && (
                          <button
                            onClick={toggleExpand}
                            className={`
                              flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px]
                              transition-colors
                              ${isExpanded 
                                ? 'bg-accent/20 text-accent ring-1 ring-accent/30' 
                                : 'bg-accent/10 text-accent hover:bg-accent/20'
                              }
                            `}
                            title={isExpanded ? 'Hide citing memories' : 'Show citing memories'}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            {ep.citing_memory_count}
                            <svg 
                              className={`w-2.5 h-2.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                              fill="none" 
                              viewBox="0 0 24 24" 
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        )}
                        <span className="text-[10px] text-theme-muted tabular-nums">
                          {relativeTime}
                        </span>
                      </div>
                    </div>

                    {/* Payload preview */}
                    <div className="text-xs text-theme-secondary line-clamp-2">
                      {(() => {
                        if (typeof ep.payload === 'object' && ep.payload !== null) {
                          const p = ep.payload as Record<string, unknown>
                          const preview = String(
                            p.text ?? p.message ?? p.content ?? p.query ?? JSON.stringify(ep.payload).slice(0, 100)
                          )
                          return preview.length > 100 ? preview.slice(0, 100) + '…' : preview
                        }
                        return String(ep.payload)
                      })()}
                    </div>

                    {/* Timestamp */}
                    <div className="mt-1.5 text-[10px] text-theme-muted">
                      {new Date(ep.created_at).toLocaleTimeString()}
                    </div>
                  </div>

                  {/* Inline Citing Memories (expanded) */}
                  {isExpanded && (
                    <InlineCitingMemories
                      episodeId={ep.id}
                      subjectId={subjectId}
                      tenantId={tenantId}
                      onMemoryClick={onMemoryClick}
                    />
                  )}
                </div>
              )
            })}

            {/* Truncation notice */}
            {timeline.episode_count > timeline.events.filter(e => e.event_type === 'episode').length && (
              <div className="text-center py-2 text-[10px] text-theme-muted">
                Showing {timeline.events.filter(e => e.event_type === 'episode').length} of {timeline.episode_count} episodes
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
