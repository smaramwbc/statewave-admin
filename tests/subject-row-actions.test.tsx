import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent, within } from '@testing-library/react'
import { SubjectRowActions } from '../src/components/SubjectRowActions'

/**
 * Per-subject row controls — kebab (⋮) icon menu.
 *
 * Pins:
 *   * the row renders a single kebab trigger (no inline buttons)
 *   * the dropdown exposes Clone subject + Export as .swmem
 *   * Clone calls /admin/memory/clone with the right body
 *   * Export fetches /admin/memory/export and the passphrase is NEVER
 *     sent to the server (the AEAD seal happens locally in lib/swmem)
 *   * Escape closes the menu
 */

beforeEach(() => {
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:fake', writable: true })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true })
  }
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function openKebab() {
  const trigger = screen.getByRole('button',  { name: /^Open subject actions for / })
  fireEvent.click(trigger)
  return trigger
}

describe('SubjectRowActions (kebab menu)', () => {
  it('renders only one trigger button by default — no inline Clone/Export', () => {
    render(<SubjectRowActions subjectId="user-1" />)
    // Single kebab trigger.
    expect(screen.getByRole('button',  { name: /^Open subject actions for user-1$/ })).toBeInTheDocument()
    // The OLD inline buttons must not exist anymore.
    expect(screen.queryByRole('button', { name: 'Clone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('opens a menu with Clone subject + Export as .swmem on click', async () => {
    render(<SubjectRowActions subjectId="user-1" />)
    await act(async () => {
      openKebab()
    })
    const menu = await waitFor(() =>
      screen.getByRole('menu') as HTMLElement,
    )
    expect(within(menu).getByRole('menuitem', { name: /Clone subject/ })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: /Export as \.swmem/ })).toBeInTheDocument()
  })

  it('Escape closes the menu', async () => {
    render(<SubjectRowActions subjectId="user-1" />)
    await act(async () => {
      openKebab()
    })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('Clone POSTs to /admin/memory/clone with the source subject id and chosen scope', async () => {
    const captured: Array<{ url: string; body: string }> = []
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      const raw = typeof url === 'string' ? url : (url as URL).toString()
      captured.push({ url: raw, body: (init?.body as string) ?? '' })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'cloned',
          source_subject_id: 'user-1',
          target_subject_id: 'user-1-clone-abc12345',
          target_display_name: null,
          clone_scope: 'episodes_memories_sources',
          episode_count: 5,
          memory_count: 2,
          source_count: 0,
          cloned_at: '2026-05-03T10:00:00Z',
        }),
      } as Response)
    })

    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    await act(async () => {
      openKebab()
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /Clone subject/ }))
    })
    const dialog = await waitFor(() => {
      const d = document.querySelector('dialog')
      expect(d).not.toBeNull()
      return d as HTMLDialogElement
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clone' }))
    })
    await waitFor(() => {
      expect(
        captured.find((c) => decodeURIComponent(c.url).includes('/admin/memory/clone')),
      ).toBeDefined()
    })
    const cloneCall = captured.find((c) =>
      decodeURIComponent(c.url).includes('/admin/memory/clone'),
    )!
    const parsed = JSON.parse(cloneCall.body)
    expect(parsed.source_subject_id).toBe('user-1')
    expect(parsed.clone_scope).toBe('episodes_memories_sources')
  })

  it('Export fetches the payload and never sends the passphrase to the server', async () => {
    const passphrase = 'super-passphrase-9999'
    const captured: Array<{ url: string; body: string }> = []
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      const raw = typeof url === 'string' ? url : (url as URL).toString()
      captured.push({ url: raw, body: (init?.body as string) ?? '' })
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          format: 'statewave-memory-payload',
          format_version: 1,
          export_id: 'exp-1',
          exported_at: '2026-05-01T00:00:00Z',
          export_scope: 'episodes_memories_sources',
          subjects: [],
          episodes: [],
          memories: [],
          sources: [],
          metadata: {},
        }),
      } as Response)
    })

    // Stub anchor.click so the auto-download in happy-dom doesn't crash.
    const origCreate = document.createElement.bind(document)
    document.createElement = ((tag: string) => {
      const el = origCreate(tag)
      if (tag.toLowerCase() === 'a') {
        ;(el as HTMLAnchorElement).click = () => {}
      }
      return el
    }) as typeof document.createElement

    try {
      await act(async () => {
        render(<SubjectRowActions subjectId="user-1" />)
      })
      await act(async () => {
        openKebab()
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('menuitem', { name: /Export as \.swmem/ }))
      })
      const dialog = await waitFor(() => {
        const d = document.querySelector('dialog')
        expect(d).not.toBeNull()
        return d as HTMLDialogElement
      })
      const passInputs = within(dialog).getAllByDisplayValue('')
        .filter((el) => (el as HTMLInputElement).type === 'password')
      expect(passInputs.length).toBe(2)
      await act(async () => {
        fireEvent.change(passInputs[0], { target: { value: passphrase } })
      })
      await act(async () => {
        fireEvent.change(passInputs[1], { target: { value: passphrase } })
      })
      await act(async () => {
        fireEvent.click(within(dialog).getByRole('button', { name: /Export \.swmem/i }))
      })
      await waitFor(() => {
        expect(
          captured.find((c) =>
            decodeURIComponent(c.url).includes('/admin/memory/export'),
          ),
        ).toBeDefined()
      })
      // Critical safety property: no request body should ever contain the
      // passphrase. The .swmem container is built locally; only the
      // plaintext payload (no key material) reaches the server.
      for (const c of captured) {
        expect(c.body).not.toContain(passphrase)
      }
    } finally {
      document.createElement = origCreate
    }
  })
})
