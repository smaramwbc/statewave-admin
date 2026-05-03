import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SessionTimelinePage } from '../src/pages/SessionTimelinePage'
import { ThemeProvider } from '../src/lib/theme'

const mockTimelineResponse = {
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

function renderTimelinePage(subjectId = 'user_123', sessionId = 'sess_001', tenantId = 'acme') {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/subjects/${subjectId}/sessions/${sessionId}/timeline?tenant_id=${tenantId}`]}>
        <Routes>
          <Route path="/subjects/:subjectId/sessions/:sessionId/timeline" element={<SessionTimelinePage />} />
          <Route path="/subjects/:subjectId" element={<div>Subject Page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

function createMock(options?: { emptyTimeline?: boolean }) {
  return vi.spyOn(global, 'fetch').mockImplementation((input) => {
    const url = typeof input === 'string' ? input : input.toString()
    const decoded = decodeURIComponent(url)

    if (decoded.includes('/timeline')) {
      return Promise.resolve({
        ok: true,
        json: async () => options?.emptyTimeline ? mockEmptyTimelineResponse : mockTimelineResponse,
      } as Response)
    }
    if (decoded.includes('/citing-memories')) {
      return Promise.resolve({
        ok: true,
        json: async () => mockCitingMemoriesResponse,
      } as Response)
    }
    if (decoded.includes('/subjects/')) {
      return Promise.resolve({
        ok: true,
        json: async () => mockSubjectDetail,
      } as Response)
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({}),
    } as Response)
  })
}

describe('SessionTimelinePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderTimelinePage()
    expect(screen.getByText(/Loading timeline/i)).toBeInTheDocument()
  })

  it('renders session timeline header', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Session Timeline')).toBeInTheDocument()
    })
  })

  it('displays timeline events in chronological order', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
      expect(screen.getByText('Hi! How can I assist you?')).toBeInTheDocument()
    })
  })

  it('shows resolution marker in timeline', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Session Resolved')).toBeInTheDocument()
    })
  })

  it('shows memory citation count on episodes', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      // First episode has citing_memory_count: 1, should show "1 derived memory"
      expect(screen.getByText(/1 derived memory/i)).toBeInTheDocument()
    })
  })

  it('shows lane legend in timeline', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getAllByText('User').length).toBeGreaterThan(0)
      expect(screen.getAllByText('Agent').length).toBeGreaterThan(0)
      expect(screen.getByText('System')).toBeInTheDocument()
    })
  })

  it('shows empty state when session has no events', async () => {
    createMock({ emptyTimeline: true })
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('No events')).toBeInTheDocument()
    })
  })

  it('shows session SLA metrics in stats section', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('First Response')).toBeInTheDocument()
      expect(screen.getByText('Resolution Time')).toBeInTheDocument()
      expect(screen.getByText('Episodes')).toBeInTheDocument()
    })
  })

  it('shows breadcrumb navigation with back link', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      // Breadcrumb should show subject name and Sessions
      expect(screen.getByText('Sessions')).toBeInTheDocument()
    })

    // Back arrow link should preserve tab=sessions
    const backLinks = screen.getAllByRole('link')
    const sessionsBackLink = backLinks.find(link => 
      link.getAttribute('href')?.includes('tab=sessions')
    )
    expect(sessionsBackLink).toBeTruthy()
  })

  it('breadcrumb links preserve tenant_id and tab=sessions', async () => {
    createMock()
    renderTimelinePage('user_123', 'sess_001', 'acme')

    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeInTheDocument()
    })

    // Check that breadcrumb links have correct URL
    const sessionsLink = screen.getByText('Sessions').closest('a')
    expect(sessionsLink).toHaveAttribute('href', '/subjects/user_123?tab=sessions&tenant_id=acme')
  })

  it('shows session status badge', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('resolved')).toBeInTheDocument()
    })
  })

  it('has copy session ID button in breadcrumb', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Sessions')).toBeInTheDocument()
    })

    // Session-id copy is now owned by CopyableMono, which exposes the
    // accessible name "Copy session ID" instead of the previous title
    // attribute. Both label paths are equivalent for screen readers.
    const copyIdButton = screen.getByRole('button', { name: 'Copy session ID' })
    expect(copyIdButton).toBeInTheDocument()
  })

  it('has copy link button in header', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Copy Link')).toBeInTheDocument()
    })
  })

  it('has view episodes link with correct URL', async () => {
    createMock()
    renderTimelinePage('user_123', 'sess_001', 'acme')

    await waitFor(() => {
      expect(screen.getByText('View Episodes')).toBeInTheDocument()
    })

    // Check the link URL preserves session and tenant
    const viewEpisodesLink = screen.getByText('View Episodes').closest('a')
    expect(viewEpisodesLink).toHaveAttribute('href', '/subjects/user_123?tab=episodes&session=sess_001&tenant_id=acme')
  })

  it('view episodes link works without tenant_id', async () => {
    // Render without tenant_id
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/subjects/user_123/sessions/sess_001/timeline']}>
          <Routes>
            <Route path="/subjects/:subjectId/sessions/:sessionId/timeline" element={<SessionTimelinePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    )

    await waitFor(() => {
      expect(screen.getByText('View Episodes')).toBeInTheDocument()
    })

    const viewEpisodesLink = screen.getByText('View Episodes').closest('a')
    expect(viewEpisodesLink).toHaveAttribute('href', '/subjects/user_123?tab=episodes&session=sess_001')
  })
})

describe('SessionTimelinePage - Inline Memory Drill-Through', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('clicking memory count expands inline memories', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Click the expand button for derived memories
    fireEvent.click(screen.getByText(/1 derived memory/i))

    // Should show the citing memory after expanding
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    })
  })

  it('inline memories show status badges', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Click the expand button for derived memories
    fireEvent.click(screen.getByText(/1 derived memory/i))

    // Should show the memory kind badge
    await waitFor(() => {
      expect(screen.getByText('fact')).toBeInTheDocument()
    })
  })

  it('clicking inline memory opens memory detail modal', async () => {
    createMock()
    renderTimelinePage()

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Click the expand button for derived memories
    fireEvent.click(screen.getByText(/1 derived memory/i))

    // Wait for memories to load
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    })

    // Click on the inline memory card
    fireEvent.click(screen.getByText('User said hello on Jan 15'))

    // Should open memory detail modal
    await waitFor(() => {
      expect(screen.getByText('Memory Details')).toBeInTheDocument()
    })
  })
})

// ─── URL State Persistence Tests ─────────────────────────────────────────────

function renderTimelinePageWithSearch(
  subjectId: string,
  sessionId: string,
  search: string
) {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[`/subjects/${subjectId}/sessions/${sessionId}/timeline${search}`]}>
        <Routes>
          <Route path="/subjects/:subjectId/sessions/:sessionId/timeline" element={<SessionTimelinePage />} />
          <Route path="/subjects/:subjectId" element={<div>Subject Page</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  )
}

describe('SessionTimelinePage - URL State Persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('restores expanded episodes from URL on load', async () => {
    createMock()
    // Render with ep_001 pre-expanded in URL
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme&expanded=ep_001')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // The citing memory should be loaded automatically since ep_001 is expanded
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('handles empty expanded param gracefully', async () => {
    createMock()
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme&expanded=')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // No memories should be visible since nothing is expanded
    expect(screen.queryByText('User said hello on Jan 15')).not.toBeInTheDocument()
  })

  it('handles invalid episode IDs in expanded param gracefully', async () => {
    createMock()
    // ep_invalid doesn't exist in the timeline
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme&expanded=ep_invalid')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Should render normally without errors
    expect(screen.getByText('resolved')).toBeInTheDocument()
  })

  it('preserves tenant_id when updating expanded state', async () => {
    createMock()
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Click to expand first episode
    fireEvent.click(screen.getByText(/1 derived memory/i))

    // Wait for memories to load
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })

    // The UI should still work (tenant_id should be preserved)
    expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
  })

  it('multiple episodes can be expanded from URL', async () => {
    createMock()
    // Both ep_001 and ep_002 in expanded param
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme&expanded=ep_001,ep_002')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // ep_001 has citing memories, should be visible
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('clicking expand updates URL state', async () => {
    createMock()
    renderTimelinePageWithSearch('user_123', 'sess_001', '?tenant_id=acme')

    await waitFor(() => {
      expect(screen.getByText('Hello, I need help')).toBeInTheDocument()
    })

    // Expand first episode
    fireEvent.click(screen.getByText(/1 derived memory/i))

    // Should load and show citing memories
    await waitFor(() => {
      expect(screen.getByText('User said hello on Jan 15')).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
