import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
    // Loading overlay shown with spinner
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('renders subjects list after fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => mockSubjects,
    } as Response)

    renderWithProviders(<SubjectsPage />)

    await waitFor(() => {
      expect(screen.getByText('user_123')).toBeInTheDocument()
    })

    expect(screen.getByText('user_456')).toBeInTheDocument()
    expect(screen.getByText('healthy')).toBeInTheDocument()
    expect(screen.getByText('watch')).toBeInTheDocument()
  })

  it('renders empty state when no subjects', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ subjects: [], total: 0, limit: 50, offset: 0 }),
    } as Response)

    renderWithProviders(<SubjectsPage />)

    await waitFor(() => {
      expect(screen.getByText('No subjects found')).toBeInTheDocument()
    })
  })

  it('renders error state on fetch failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Network error'))

    renderWithProviders(<SubjectsPage />)

    await waitFor(() => {
      expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    })
  })
})
