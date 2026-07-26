import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SubjectsPage } from '../src/pages/SubjectsPage'
import { ThemeProvider } from '../src/lib/theme'

const mockSubjects = {
  subjects: [
    {
      subject_id: 'user_123',
      tenant_id: 'acme',
      episode_count: 45,
      memory_count: 12,
      last_episode_at: '2026-04-30T10:00:00Z',
      health_state: 'healthy',
      health_score: 85,
      open_sessions: 0,
    },
    {
      subject_id: 'user_456',
      tenant_id: 'acme',
      episode_count: 23,
      memory_count: 8,
      last_episode_at: '2026-04-29T15:00:00Z',
      health_state: 'watch',
      health_score: 65,
      open_sessions: 1,
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <ThemeProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ThemeProvider>
  )
}

describe('SubjectsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders loading state initially', () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise(() => {}))
    renderWithProviders(<SubjectsPage />)
    // Initial load renders a TableSkeleton (animate-pulse blocks) instead
    // of the previous full-page LoadingOverlay.
    expect(document.querySelector('.animate-pulse')).toBeInTheDocument()
  })

  it('renders subjects list after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjects,
    } as Response)

    renderWithProviders(<SubjectsPage />)

    // The page now renders BOTH the mobile-card list and the md+
    // table simultaneously (each gated by CSS visibility), so subject
    // ids appear twice in the DOM. We assert "at least once" rather
    // than "exactly once" — that's what the responsive design promises.
    await waitFor(() => {
      expect(screen.getAllByText('user_123').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('user_456').length).toBeGreaterThan(0)
    expect(screen.getAllByText('healthy').length).toBeGreaterThan(0)
    expect(screen.getAllByText('watch').length).toBeGreaterThan(0)
  })

  it('renders empty state when no subjects', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ subjects: [], total: 0, limit: 50, offset: 0 }),
    } as Response)

    renderWithProviders(<SubjectsPage />)

    await waitFor(() => {
      // Premium copy says "No subjects yet" when the workspace is truly
      // empty (no filters set).
      expect(screen.getByText('No subjects yet')).toBeInTheDocument()
    })
  })

  it('renders error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

    renderWithProviders(<SubjectsPage />)

    await waitFor(() => {
      // The structured ErrorState now leads with "Failed to load subjects"
      // (what broke), with the underlying message available behind the
      // technical-details disclosure.
      expect(screen.getByText('Failed to load subjects')).toBeInTheDocument()
    })
  })
})
