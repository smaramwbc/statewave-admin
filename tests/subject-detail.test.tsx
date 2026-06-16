import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SubjectDetailPage } from '../src/pages/SubjectDetailPage'
import { ThemeProvider } from '../src/lib/theme'

const mockSubjectDetail = {
  subject_id: 'user_123',
  tenant_id: 'acme',
  summary: {
    episode_count: 45,
    memory_count: 12,
    session_count: 3,
    first_seen_at: '2026-01-15T10:00:00Z',
    last_activity_at: '2026-04-30T10:00:00Z',
  },
  health: {
    score: 85,
    state: 'healthy',
    factors: [
      { signal: 'resolution_rate', impact: 10, detail: 'High resolution rate' },
      { signal: 'recent_activity', impact: 5, detail: 'Active in last 7 days' },
    ],
  },
  sla: {
    total_sessions: 3,
    resolved_sessions: 2,
    open_sessions: 1,
    avg_first_response_seconds: 120,
    avg_resolution_seconds: 3600,
    first_response_breach_count: 0,
    resolution_breach_count: 0,
  },
}

function renderWithRouter(subjectId: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/subjects/${subjectId}`]}>
        <Routes>
          <Route path="/subjects/:subjectId" element={<SubjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('SubjectDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderWithRouter('user_123')
    // Initial load uses skeleton placeholders (animate-pulse blocks)
    // matching the eventual page shape rather than a LoadingOverlay.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders subject detail after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Check health badge is shown (use getAllBy since 'healthy' appears multiple places)
    const healthyElements = screen.getAllByText('healthy')
    expect(healthyElements.length).toBeGreaterThan(0)

    // Check group tabs are rendered (10 leaf tabs collapsed into 4 groups)
    const tabs = document.querySelectorAll('button')
    const tabLabels = Array.from(tabs).map((t) => t.textContent)
    expect(tabLabels.some((l) => l?.includes('Overview'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Memories'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Episodes'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Debug'))).toBe(true)
  })

  it('renders error state on 404', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response)

    renderWithRouter('nonexistent')

    await waitFor(() => {
      // Structured ErrorState leads with the page-specific title.
      expect(screen.getByText('Failed to load subject')).toBeInTheDocument()
    })
  })

  it('shows health factors in overview', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('Health Factors')).toBeInTheDocument()
    })

    expect(screen.getByText('resolution_rate')).toBeInTheDocument()
    expect(screen.getByText('High resolution rate')).toBeInTheDocument()
  })
})

// ─── Navigation Tests ────────────────────────────────────────────────────────

describe('Subject Detail - Tab Navigation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all tabs after subject loads', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Check all tabs are rendered with their labels
    const buttons = screen.getAllByRole('button')
    const tabLabels = buttons.map((b) => b.textContent)
    
    expect(tabLabels.some((l) => l?.includes('Overview'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Memories'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Episodes'))).toBe(true)
    expect(tabLabels.some((l) => l?.includes('Debug'))).toBe(true)
  })

  it('shows memory count in tab badge', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      // The memory count (12) should appear in the Memories tab
      const buttons = screen.getAllByRole('button')
      const memoriesTab = buttons.find((b) => b.textContent?.includes('Memories'))
      expect(memoriesTab?.textContent).toContain('12')
    })
  })

  it('shows episode count in tab badge', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      // The episode count (45) should appear in the Episodes tab
      const buttons = screen.getAllByRole('button')
      const episodesTab = buttons.find((b) => b.textContent?.includes('Episodes'))
      expect(episodesTab?.textContent).toContain('45')
    })
  })

  it('shows session count in tab badge', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)

    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Sessions sub-tab is inside the Episodes group — activate it first
    const episodesGroup = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesGroup!)

    await waitFor(() => {
      // Sessions sub-tab is now visible and shows session count
      const buttons = screen.getAllByRole('button')
      const sessionsTab = buttons.find((b) => b.textContent?.includes('Sessions'))
      expect(sessionsTab?.textContent).toContain('3')
    })
  })
})

// ─── Interaction Tests ───────────────────────────────────────────────────────

const mockMemoriesResponse = {
  memories: [
    {
      id: 'mem_001',
      kind: 'preference',
      content: 'User prefers dark mode',
      summary: 'UI preference',
      confidence: 0.95,
      status: 'active',
      source_episode_ids: ['ep_001', 'ep_002'],
      valid_from: '2026-01-15T10:00:00Z',
      valid_to: null,
      created_at: '2026-01-15T10:00:00Z',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
}

const mockEpisodesResponse = {
  episodes: [
    {
      id: 'ep_001',
      session_id: 'sess_001',
      source: 'chat',
      type: 'message',
      payload: { text: 'Hello' },
      metadata: {},
      provenance: {},
      created_at: '2026-01-15T10:00:00Z',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
}

const mockSessionsResponse = {
  sessions: [
    {
      session_id: 'sess_001',
      status: 'resolved',
      first_message_at: '2026-01-15T10:00:00Z',
      first_response_at: '2026-01-15T10:00:30Z',
      resolved_at: '2026-01-15T10:30:00Z',
      first_response_seconds: 30,
      resolution_seconds: 1800,
      open_duration_seconds: null,
      first_response_breached: false,
      resolution_breached: false,
    },
  ],
  total_sessions: 1,
  resolved_sessions: 1,
  open_sessions: 0,
}

const mockCitingMemoriesResponse = {
  memories: [
    {
      id: 'mem_citing_001',
      kind: 'fact',
      content: 'User said hello on Jan 15',
      summary: 'Greeting recorded',
      confidence: 0.9,
      status: 'active',
      source_episode_ids: ['ep_001'],
      valid_from: '2026-01-15T10:00:00Z',
      valid_to: null,
      created_at: '2026-01-15T10:01:00Z',
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
}

const mockEmptyCitingMemoriesResponse = {
  memories: [],
  total: 0,
  limit: 50,
  offset: 0,
}

const mockSessionTimelineResponse = {
  session_id: 'sess_001',
  status: 'resolved',
  first_message_at: '2026-01-15T10:00:00Z',
  first_response_at: '2026-01-15T10:00:30Z',
  resolved_at: '2026-01-15T10:30:00Z',
  first_response_seconds: 30,
  resolution_seconds: 1800,
  first_response_breached: false,
  resolution_breached: false,
  episode_count: 3,
  events: [
    {
      event_type: 'episode',
      id: 'ep_001',
      source: 'user',
      type: 'message',
      payload: { text: 'Hello, I need help' },
      metadata: {},
      provenance: {},
      created_at: '2026-01-15T10:00:00Z',
      citing_memory_count: 1,
    },
    {
      event_type: 'episode',
      id: 'ep_002',
      source: 'agent',
      type: 'response',
      payload: { text: 'Hi! How can I assist you?' },
      metadata: {},
      provenance: {},
      created_at: '2026-01-15T10:00:30Z',
      citing_memory_count: 0,
    },
    {
      event_type: 'resolution',
      resolved_at: '2026-01-15T10:30:00Z',
      status: 'resolved',
    },
  ],
}

const mockEmptyTimelineResponse = {
  session_id: 'sess_empty',
  status: 'open',
  first_message_at: null,
  first_response_at: null,
  resolved_at: null,
  first_response_seconds: null,
  resolution_seconds: null,
  first_response_breached: false,
  resolution_breached: false,
  episode_count: 0,
  events: [],
}

const mockMemoryEvolutionResponse = {
  memory_id: 'mem_001',
  status: 'active',
  created_at: '2026-01-15T10:00:00Z',
  superseding_memory: null,
  superseded_memories: [
    {
      id: 'mem_old_001',
      kind: 'preference',
      content: 'User used to prefer light mode',
      summary: 'Old preference',
      confidence: 0.8,
      status: 'superseded',
      created_at: '2026-01-10T10:00:00Z',
      relationship: 'superseded_by',
    },
  ],
  sibling_memories: [],
  source_episode_count: 2,
}

const mockSupersededMemoryEvolutionResponse = {
  memory_id: 'mem_superseded_001',
  status: 'superseded',
  created_at: '2026-01-10T10:00:00Z',
  superseding_memory: {
    id: 'mem_new_001',
    kind: 'preference',
    content: 'User now prefers dark mode',
    summary: 'Current preference',
    confidence: 0.95,
    status: 'active',
    created_at: '2026-01-15T10:00:00Z',
    relationship: 'supersedes',
  },
  superseded_memories: [],
  sibling_memories: [],
  source_episode_count: 1,
}

// Helper to create a comprehensive mock that handles all endpoints
function createComprehensiveMock(options?: { 
  emptyCitingMemories?: boolean
  emptyTimeline?: boolean
  memoryEvolution?: 'active' | 'superseded' | 'empty'
}) {
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString()
    // Decode the URL to match against the path parameter
    const decoded = decodeURIComponent(url)
    
    // Return timeline for session timeline endpoint
    if (decoded.includes('/timeline')) {
      return Promise.resolve({
        ok: true,
        json: async () => options?.emptyTimeline 
          ? mockEmptyTimelineResponse 
          : mockSessionTimelineResponse,
      } as Response)
    }
    // Return memory evolution for related endpoint
    if (decoded.includes('/related')) {
      const evolutionResponse = options?.memoryEvolution === 'superseded'
        ? mockSupersededMemoryEvolutionResponse
        : options?.memoryEvolution === 'empty'
          ? { memory_id: 'mem_001', status: 'active', created_at: '2026-01-15T10:00:00Z', superseding_memory: null, superseded_memories: [], sibling_memories: [], source_episode_count: 0 }
          : mockMemoryEvolutionResponse
      return Promise.resolve({
        ok: true,
        json: async () => evolutionResponse,
      } as Response)
    }
    // Return citing memories for reverse provenance endpoint
    if (decoded.includes('/citing-memories')) {
      return Promise.resolve({
        ok: true,
        json: async () => options?.emptyCitingMemories
          ? mockEmptyCitingMemoriesResponse
          : mockCitingMemoriesResponse,
      } as Response)
    }
    // Activity heatmap endpoint
    if (decoded.includes('/activity')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ days: [], subject_id: 'user_123', window_days: 91 }),
      } as Response)
    }
    // Retrieval simulator endpoint
    if (decoded.includes('/retrieval-simulate')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [],
          query: '',
          tokens_used: 0,
          token_budget: 2000,
          embedding_available: false,
          error: null,
        }),
      } as Response)
    }
    // Memory provenance endpoint
    if (decoded.includes('/provenance')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          memory: { id: 'mem_001', kind: 'fact', content: '', summary: '', confidence: 1, status: 'active', created_at: '', source_episode_ids: [] },
          source_episodes: [],
          sibling_memories: [],
        }),
      } as Response)
    }
    // Compiler trace endpoint
    if (decoded.includes('/compiler-trace')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          memory_id: 'mem_001',
          kind: 'profile_fact',
          content: 'User prefers dark mode',
          summary: '',
          confidence: 0.9,
          status: 'active',
          created_at: '2026-01-15T10:00:00Z',
          compiler: 'llm',
          model: 'gpt-4o',
          source_episode_count: 2,
          reconstructed_input: [
            { id: 'ep_001', source: 'api', type: 'chat.note', payload: { text: 'I like dark mode' }, created_at: '2026-01-14T10:00:00Z', text_preview: 'I like dark mode' },
          ],
        }),
      } as Response)
    }
    // Conflict detector endpoint
    if (decoded.includes('/conflicts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          pairs: [],
          total_memories_checked: 12,
          embedding_available: false,
          error: 'Conflict detection requires real embeddings.',
        }),
      } as Response)
    }
    // Memory timeline endpoint
    if (decoded.includes('/memory-timeline')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          events: [
            { date: '2026-01-15', memories_added: 5, cumulative_count: 5 },
            { date: '2026-02-01', memories_added: 3, cumulative_count: 8 },
          ],
          snapshot_at: null,
          memories_at_snapshot: [
            { id: 'mem_001', kind: 'profile_fact', content_preview: 'User prefers dark mode', confidence: 0.9, status: 'active', created_at: '2026-01-15T10:00:00Z' },
          ],
          subject_id: 'user_123',
        }),
      } as Response)
    }
    // Policy sandbox endpoint
    if (decoded.includes('/policy-sandbox')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [
            { memory_id: 'mem_001', kind: 'profile_fact', content_preview: 'User prefers dark mode', sensitivity_labels: [], action: 'allow', rule_id: null, matched_labels: [] },
          ],
          total_memories: 1,
          allowed: 1,
          denied: 0,
          redacted: 0,
          error: null,
        }),
      } as Response)
    }
    // Memory clusters endpoint
    if (decoded.includes('/memory-clusters')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          points: [],
          total_memories: 0,
          embedding_available: false,
          error: 'Cluster view requires real embeddings.',
        }),
      } as Response)
    }
    // Admin receipts regression endpoint
    if (decoded.includes('/regression')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          receipt_id: 'rcpt_001',
          receipt_as_of: '2026-01-15T10:00:00Z',
          stable: [],
          dropped: [],
          new_memories: [],
        }),
      } as Response)
    }
    // Admin receipts list endpoint
    if (decoded.includes('/admin-receipts')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          items: [
            { receipt_id: 'rcpt_001', as_of: '2026-01-15T10:00:00Z', created_at: '2026-01-15T10:00:00Z', mode: 'standard', context_size_bytes: 2048, memory_count: 5 },
          ],
          total: 1,
        }),
      } as Response)
    }
    // Return memories for memories endpoint
    if (decoded.includes('/memories')) {
      return Promise.resolve({
        ok: true,
        json: async () => mockMemoriesResponse,
      } as Response)
    }
    // Return episodes for episodes endpoint
    if (decoded.includes('/episodes')) {
      return Promise.resolve({
        ok: true,
        json: async () => mockEpisodesResponse,
      } as Response)
    }
    // Return sessions for SLA endpoint
    if (decoded.includes('/sla')) {
      return Promise.resolve({
        ok: true,
        json: async () => mockSessionsResponse,
      } as Response)
    }
    // Default: subject detail
    return Promise.resolve({
      ok: true,
      json: async () => mockSubjectDetail,
    } as Response)
  })
}

describe('Subject Detail - Inspector Interactions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('loads and displays memories when Memories tab is clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    // Wait for subject to load
    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Click Memories tab
    const memoriesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))
    fireEvent.click(memoriesTab!)

    // Wait for memories to load and show provenance link
    await waitFor(() => {
      expect(screen.getByText(/source episode/)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('loads and displays episodes when Episodes tab is clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Click Episodes tab
    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    // Wait for episodes to load
    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('loads and displays sessions when Sessions tab is clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Sessions is a sub-tab inside the Episodes group — activate group first
    const episodesGroup = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesGroup!)

    // Sessions sub-tab is now in DOM
    const sessionsTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Sessions'))
    fireEvent.click(sessionsTab!)

    // Wait for sessions to load
    await waitFor(() => {
      expect(screen.getByText('sess_001')).toBeInTheDocument()
      expect(screen.getByText('resolved')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows Filter episodes link in sessions tab', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Sessions is a sub-tab inside the Episodes group — activate group first
    const episodesGroup = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesGroup!)

    const sessionsTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Sessions'))
    fireEvent.click(sessionsTab!)

    await waitFor(() => {
      expect(screen.getByText(/Filter episodes/)).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})

// ─── Reverse Provenance Tests ────────────────────────────────────────────────

describe('Subject Detail - Reverse Provenance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows citing memories section in episode detail modal', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    // Wait for subject to load
    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Navigate to Episodes tab
    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    // Wait for episodes to load
    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click on the episode row to open detail modal
    const episodeRow = screen.getByText('message').closest('div[class*="cursor-pointer"]')
    fireEvent.click(episodeRow!)

    // Should show Episode Details modal with Cited by Memories section
    await waitFor(() => {
      expect(screen.getByText('Episode Details')).toBeInTheDocument()
      expect(screen.getByText('Cited by Memories')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Should load and display citing memories
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows citing memory count in episode detail modal', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })

    const episodeRow = screen.getByText('message').closest('div[class*="cursor-pointer"]')
    fireEvent.click(episodeRow!)

    // Should show count (1) in the section header
    await waitFor(() => {
      expect(screen.getByText(/Cited by Memories/)).toBeInTheDocument()
      expect(screen.getByText('(1)')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows empty state when no memories cite the episode', async () => {
    createComprehensiveMock({ emptyCitingMemories: true })
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })

    const episodeRow = screen.getByText('message').closest('div[class*="cursor-pointer"]')
    fireEvent.click(episodeRow!)

    // Should show empty state message
    await waitFor(() => {
      expect(screen.getByText('Cited by Memories')).toBeInTheDocument()
      expect(screen.getByText('No memories cite this episode yet')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('shows Open memory link for citing memories', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })

    const episodeRow = screen.getByText('message').closest('div[class*="cursor-pointer"]')
    fireEvent.click(episodeRow!)

    // Should show "Open memory" link
    await waitFor(() => {
      expect(screen.getByText('Open memory →')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('clicking citing memory opens memory detail modal', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const episodesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))
    fireEvent.click(episodesTab!)

    await waitFor(() => {
      expect(screen.getByText('message')).toBeInTheDocument()
    }, { timeout: 3000 })

    const episodeRow = screen.getByText('message').closest('div[class*="cursor-pointer"]')
    fireEvent.click(episodeRow!)

    // Wait for citing memories to load
    await waitFor(() => {
      expect(screen.getByText('Open memory →')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click on the "Open memory" link
    fireEvent.click(screen.getByText('Open memory →'))

    // Should close episode modal and open memory detail modal
    await waitFor(() => {
      expect(screen.getByText('Memory Details')).toBeInTheDocument()
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})

// ─── Session Timeline Link Tests ─────────────────────────────────────────────
// Note: Full timeline page tests are in session-timeline.test.tsx

describe('Subject Detail - Session Timeline', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows View timeline link in Sessions tab', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Sessions is a sub-tab inside Episodes group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Sessions'))!)

    // Wait for sessions to load and show timeline link
    await waitFor(() => {
      expect(screen.getByText('View timeline →')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('View timeline link points to correct timeline page', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Sessions is a sub-tab inside Episodes group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))!)
    const sessionsTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Sessions'))
    fireEvent.click(sessionsTab!)

    await waitFor(() => {
      expect(screen.getByText('View timeline →')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify the link has the correct href
    const timelineLink = screen.getByText('View timeline →')
    expect(timelineLink.closest('a')).toHaveAttribute('href', expect.stringContaining('/sessions/sess_001/timeline'))
  })
})

// ─── URL State Persistence Tests ────────────────────────────────────────────

function renderWithRouterAndSearch(subjectId: string, search: string) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/subjects/${subjectId}${search}`]}>
        <Routes>
          <Route path="/subjects/:subjectId" element={<SubjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('Subject Detail - URL State Persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // Mock fetch for all tests in this block
    // The API uses a proxy endpoint: /api/proxy?path=...
    vi.spyOn(global, 'fetch').mockImplementation((url: RequestInfo | URL) => {
      const urlStr = decodeURIComponent(url.toString())
      
      // Subject detail endpoint (must not have /memories, /episodes, /sessions in path)
      if (urlStr.includes('/admin/subjects/user_123') && 
          !urlStr.includes('/memories') && 
          !urlStr.includes('/episodes') && 
          !urlStr.includes('/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => mockSubjectDetail,
        } as Response)
      }
      
      if (urlStr.includes('/memories')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            memories: [
              { id: 'mem_1', content: 'Test memory 1', kind: 'fact', status: 'active', confidence: 0.9, created_at: '2026-04-01', source_episode_ids: [] },
              { id: 'mem_2', content: 'Test memory 2', kind: 'preference', status: 'superseded', confidence: 0.8, created_at: '2026-04-02', source_episode_ids: [] },
            ],
            total: 12,
          }),
        } as Response)
      }
      
      if (urlStr.includes('/episodes')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            episodes: [
              { id: 'ep_1', session_id: 'sess_1', source: 'chat', type: 'message', payload: { text: 'Hello' }, created_at: '2026-04-01', citing_memory_count: 2 },
              { id: 'ep_2', session_id: 'sess_1', source: 'chat', type: 'message', payload: { text: 'World' }, created_at: '2026-04-02', citing_memory_count: 0 },
            ],
            total: 45,
          }),
        } as Response)
      }
      
      if (urlStr.includes('/sessions')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            sessions: [{ session_id: 'sess_001', status: 'resolved', first_message_at: '2026-04-01T10:00:00Z', resolved_at: '2026-04-01T11:00:00Z' }],
            total_sessions: 3,
            resolved_sessions: 2,
            open_sessions: 1,
          }),
        } as Response)
      }
      
      // Default: return empty response for unknown endpoints
      console.log('[test] Unhandled fetch:', urlStr)
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('restores active tab from URL', async () => {
    renderWithRouterAndSearch('user_123', '?tab=memories')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Wait for memories tab content to load
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search memories…')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('restores memories tab with search query from URL', async () => {
    renderWithRouterAndSearch('user_123', '?tab=memories&mq=test')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search memories…')
      expect(searchInput).toHaveValue('test')
    }, { timeout: 3000 })
  })

  it('restores memories tab with status filter from URL', async () => {
    renderWithRouterAndSearch('user_123', '?tab=memories&ms=superseded')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // The superseded filter button should be selected
    await waitFor(() => {
      const buttons = screen.getAllByRole('button')
      const supersededBtn = buttons.find((b) => b.textContent === 'Superseded')
      // Selected buttons have specific styling - check if it has the accent class
      expect(supersededBtn?.className).toContain('border-accent')
    }, { timeout: 3000 })
  })

  it('restores episodes tab with search query from URL', async () => {
    renderWithRouterAndSearch('user_123', '?tab=episodes&eq=hello')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    await waitFor(() => {
      const searchInput = screen.getByPlaceholderText('Search episodes…')
      expect(searchInput).toHaveValue('hello')
    }, { timeout: 3000 })
  })

  it('restores session filter from URL on episodes tab', async () => {
    renderWithRouterAndSearch('user_123', '?tab=episodes&session=sess_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Should show session filter banner
    await waitFor(() => {
      expect(screen.getByText(/Filtered to session/)).toBeInTheDocument()
      expect(screen.getByText('sess_123')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('defaults to overview tab when no tab param', async () => {
    renderWithRouterAndSearch('user_123', '')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Overview content should be visible (health factors, SLA metrics)
    await waitFor(() => {
      expect(screen.getByText('Health Factors')).toBeInTheDocument()
    })
  })

  it('ignores invalid tab value and defaults to overview', async () => {
    renderWithRouterAndSearch('user_123', '?tab=invalid')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Overview content should be visible
    await waitFor(() => {
      expect(screen.getByText('Health Factors')).toBeInTheDocument()
    })
  })

  it('clicking tab updates URL', async () => {
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/subjects/user_123']}>
          <Routes>
            <Route path="/subjects/:subjectId" element={<SubjectDetailPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Click on Memories tab
    const memoriesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))
    fireEvent.click(memoriesTab!)

    // The tab should switch (Memories content should appear)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search memories…')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})

// Note: Inline memory drill-through tests are in session-timeline.test.tsx

// ─── Inspector Feature Tests ──────────────────────────────────────────────────

describe('Subject Detail - New Inspector Features (tabs)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders 4 group tabs and exposes sub-tabs on activation', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // 4 top-level group tabs are always visible
    const allBtns = screen.getAllByRole('button')
    const allLabels = allBtns.map((b) => b.textContent)
    expect(allLabels.some((l) => l?.includes('Overview'))).toBe(true)
    expect(allLabels.some((l) => l?.includes('Memories'))).toBe(true)
    expect(allLabels.some((l) => l?.includes('Episodes'))).toBe(true)
    expect(allLabels.some((l) => l?.includes('Debug'))).toBe(true)

    // Memories group reveals Retrieval / Conflicts / Timeline / Clusters sub-tabs
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))!)
    const memBtns = screen.getAllByRole('button').map((b) => b.textContent)
    expect(memBtns.some((l) => l?.includes('Retrieval'))).toBe(true)
    expect(memBtns.some((l) => l?.includes('Conflicts'))).toBe(true)
    expect(memBtns.some((l) => l?.includes('Timeline'))).toBe(true)
    expect(memBtns.some((l) => l?.includes('Clusters'))).toBe(true)

    // Episodes group reveals Sessions sub-tab
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Episodes'))!)
    expect(screen.getAllByRole('button').some((b) => b.textContent?.includes('Sessions'))).toBe(true)

    // Debug group reveals Policy + Receipts sub-tabs
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Debug'))!)
    const dbgBtns = screen.getAllByRole('button').map((b) => b.textContent)
    expect(dbgBtns.some((l) => l?.includes('Policy'))).toBe(true)
    expect(dbgBtns.some((l) => l?.includes('Receipts'))).toBe(true)
  })

  it('shows Conflicts tab content when clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Conflicts is a sub-tab inside Memories group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Conflicts'))!)

    await waitFor(() => {
      expect(screen.getByText('Memory Conflict Detector')).toBeInTheDocument()
    })
  })

  it('shows Timeline tab content when clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Timeline is a sub-tab inside Memories group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Timeline'))!)

    await waitFor(() => {
      expect(screen.getByText('Memory Timeline')).toBeInTheDocument()
    })
  })

  it('shows Policy tab with YAML textarea when clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Policy is a sub-tab inside Debug group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Debug'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Policy'))!)

    await waitFor(() => {
      expect(screen.getByText('Policy Sandbox')).toBeInTheDocument()
    })

    // YAML textarea should be visible
    const textarea = document.querySelector('textarea')
    expect(textarea).toBeInTheDocument()
  })

  it('shows Clusters tab content when clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Clusters is a sub-tab inside Memories group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Clusters'))!)

    await waitFor(() => {
      expect(screen.getByText('Memory Cluster View')).toBeInTheDocument()
    })
  })

  it('shows Receipts tab with receipt list when clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Receipts is a sub-tab inside Debug group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Debug'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Receipts'))!)

    await waitFor(() => {
      expect(screen.getByText('Retrieval Regression Tester')).toBeInTheDocument()
    })

    // Receipt list should load
    await waitFor(() => {
      expect(screen.getByText(/rcpt_001/)).toBeInTheDocument()
    })
  })
})

describe('Subject Detail - Compiler Trace Modal', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('shows Trace button on memory cards', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const memoriesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))
    fireEvent.click(memoriesTab!)

    await waitFor(() => {
      const traceLinks = screen.getAllByText(/Trace →/)
      expect(traceLinks.length).toBeGreaterThan(0)
    })
  })

  it('opens compiler trace modal when Trace button is clicked', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    const memoriesTab = screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))
    fireEvent.click(memoriesTab!)

    await waitFor(() => {
      expect(screen.getAllByText(/Trace →/).length).toBeGreaterThan(0)
    })

    const traceButton = screen.getAllByText(/Trace →/)[0]
    fireEvent.click(traceButton)

    await waitFor(() => {
      expect(screen.getByText('Compiler Trace')).toBeInTheDocument()
    })

    // Should show compiler metadata section
    await waitFor(() => {
      expect(screen.getByText('Compiler metadata')).toBeInTheDocument()
    })
  })
})

describe('Subject Detail - Conflicts scan', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('runs conflict scan and shows stub error for non-semantic embeddings', async () => {
    createComprehensiveMock()
    renderWithRouter('user_123')

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    // Conflicts is a sub-tab inside Memories group
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Memories'))!)
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Conflicts'))!)

    await waitFor(() => {
      expect(screen.getByText('Scan for conflicts')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Scan for conflicts'))

    await waitFor(() => {
      expect(screen.getByText(/Conflict detection requires real embeddings/)).toBeInTheDocument()
    })
  })
})
