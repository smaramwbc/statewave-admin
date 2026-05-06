/**
 * UI tests for the PersonaHealthPanel mounted on /diagnostics.
 *
 * Pins what an operator sees:
 *   - On mount, calls the persona-health endpoint and renders one row per
 *     persona with its status badge, counts, and per-probe rank.
 *   - "Re-run probes" forces a fresh fetch with ?force=true.
 *   - Network error renders a non-throwing inline message.
 *   - "not_configured" status reads as such, not as a fail.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  waitFor,
  act,
  cleanup,
  fireEvent,
} from '@testing-library/react'
import { PersonaHealthPanel } from '../src/components/PersonaHealthPanel'
import type { PersonaHealthReport } from '../src/lib/api'

function makeReport(): PersonaHealthReport {
  return {
    fetched_at: '2026-05-06T17:00:00Z',
    personas: [
      {
        pack_id: 'demo-coding-assistant',
        display_name: 'Coding assistant (Priya at Stratus)',
        version: '2.2026.05.06-focused',
        episode_count: 44,
        memory_count: 61,
        embedding_coverage: 1.0,
        probes: [
          {
            query: 'What backend stack does Priya use?',
            expected_substring: 'fastapi',
            rank: 1,
            pass: true,
            top_memory_preview: 'FastAPI + SQLModel...',
          },
          {
            query: 'Where do shared TypeScript types live?',
            expected_substring: '@stratus/types',
            rank: 1,
            pass: true,
            top_memory_preview: '@stratus/types package',
          },
          {
            query: 'What is the policy on database mocking in tests?',
            expected_substring: 'never mock',
            rank: 1,
            pass: true,
            top_memory_preview: 'never mock the database',
          },
        ],
        status: 'pass',
        error: null,
      },
      {
        pack_id: 'demo-research-assistant',
        display_name: 'Research assistant (Arushi, NeurIPS)',
        version: '2.2026.05.06-focused',
        episode_count: 43,
        memory_count: 32,
        embedding_coverage: 0.97,
        probes: [
          {
            query: 'Who is the co-author on the NeurIPS paper?',
            expected_substring: 'mei wu',
            rank: 17,
            pass: false,
            top_memory_preview: 'irrelevant memory text',
          },
        ],
        status: 'warn',
        error: null,
      },
    ],
  }
}

describe('PersonaHealthPanel', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((async () =>
      new Response(JSON.stringify(makeReport()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown) as typeof fetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  it('renders one row per persona with status badge + counts', async () => {
    render(<PersonaHealthPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Coding assistant/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Research assistant/i)).toBeInTheDocument()
    // Status badges — exact-text + the right count for each.
    expect(screen.getAllByText('PASS')).toHaveLength(1)
    expect(screen.getAllByText('WARN')).toHaveLength(1)
    // Counts — coding-assistant only.
    expect(screen.getByText('44')).toBeInTheDocument()
    expect(screen.getByText('61')).toBeInTheDocument()
  })

  it('renders per-probe ranks (pass + warn cases)', async () => {
    render(<PersonaHealthPanel />)
    await waitFor(() => {
      expect(screen.getByText(/What backend stack does Priya use\?/i)).toBeInTheDocument()
    })
    // Coding assistant probes — 3× rank 1
    const rankOnes = screen.getAllByText(/rank 1$/i)
    expect(rankOnes.length).toBeGreaterThanOrEqual(3)
    // Research assistant: rank 17 with (warn) suffix
    expect(screen.getByText(/rank 17 \(warn\)/i)).toBeInTheDocument()
  })

  it('Re-run probes button forces a fresh fetch with ?force=true', async () => {
    render(<PersonaHealthPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Coding assistant/i)).toBeInTheDocument()
    })
    const calls0 = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
      .mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Re-run probes/i }))
    })
    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } })
        .mock.calls
      expect(calls.length).toBe(calls0 + 1)
      const url = String(calls[calls.length - 1][0])
      expect(url).toContain('force=true')
    })
  })

  it('renders an inline error message on network failure (non-throwing)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(((async () => {
      throw new Error('boom')
    }) as unknown) as typeof fetch)
    render(<PersonaHealthPanel />)
    await waitFor(() => {
      expect(screen.getByText(/Error: boom/i)).toBeInTheDocument()
    })
  })

  it('reads "not_configured" status as its own label, not as a fail', async () => {
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () =>
      new Response(
        JSON.stringify({
          fetched_at: '2026-05-06T17:00:00Z',
          personas: [
            {
              pack_id: 'demo-support-agent',
              display_name: 'Support',
              version: null,
              episode_count: null,
              memory_count: null,
              embedding_coverage: null,
              probes: [],
              status: 'not_configured',
              error: 'STATEWAVE_API_URL is not configured',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch)
    render(<PersonaHealthPanel />)
    await waitFor(() => {
      expect(screen.getByText('NOT CONFIGURED')).toBeInTheDocument()
    })
    // Should NOT also show a FAIL badge for the same persona.
    expect(screen.queryByText('FAIL')).not.toBeInTheDocument()
  })
})
