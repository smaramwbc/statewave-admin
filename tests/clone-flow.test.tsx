import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  waitFor,
  act,
  cleanup,
  fireEvent,
  within,
} from '@testing-library/react'
import { Toaster } from 'sonner'
import { SubjectRowActions } from '../src/components/SubjectRowActions'

/**
 * End-to-end Subject Clone tests pinned to the spec contracts.
 *
 *   * the row's kebab menu exposes a "Clone subject" item
 *   * clicking it opens a modal that displays the source subject id
 *   * the modal's helper copy mentions that cloning is independent
 *   * the default Clone scope is "Episodes + memories + sources"
 *   * a successful clone POSTs to /admin/memory/clone with the typed
 *     target id + scope, fires a "Subject cloned" toast, and surfaces
 *     a link to the new subject so the operator can jump straight in
 *   * a 409 backend response is shown clearly inside the modal
 *   * passphrase / encryption / export terminology must NOT appear in
 *     the clone modal (negative regression — the prior pass mixed
 *     export + clone in the same component)
 */

beforeEach(() => {
  // Stub URL helpers — happy-dom's createObjectURL is not exhaustive.
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:fake', writable: true })
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, writable: true })
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

async function openCloneModal(subjectId: string) {
  await act(async () => {
    fireEvent.click(
      screen.getByRole('button', { name: new RegExp(`Open subject actions for ${subjectId}`) }),
    )
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: /Clone subject/ }))
  })
  return await waitFor(() => {
    const d = document.querySelector('dialog')
    expect(d).not.toBeNull()
    return d as HTMLDialogElement
  })
}

describe('Subject row Clone action', () => {
  it('shows "Clone subject" in the kebab menu', async () => {
    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: /Open subject actions for user-1/ }),
      )
    })
    expect(
      screen.getByRole('menuitem', { name: /Clone subject/ }),
    ).toBeInTheDocument()
  })

  it('opens a modal that surfaces the source subject id and the independence helper copy', async () => {
    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    const dialog = await openCloneModal('user-1')
    // Source id is rendered (CopyableMono mono chip).
    expect(within(dialog).getByText('user-1')).toBeInTheDocument()
    // Helper copy from the spec.
    expect(
      within(dialog).getByText(
        /Cloning creates an independent subject for experiments\. The original subject is not changed\./,
      ),
    ).toBeInTheDocument()
    // Default scope is the full one.
    const select = within(dialog).getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('episodes_memories_sources')
  })

  it('does NOT surface passphrase / encryption / export controls in the clone modal', async () => {
    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    const dialog = await openCloneModal('user-1')
    // Negative regression: clone has nothing to do with .swmem export.
    expect(within(dialog).queryByText(/Passphrase/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/Encrypt/i)).not.toBeInTheDocument()
    expect(within(dialog).queryByText(/\.swmem/i)).not.toBeInTheDocument()
  })
})

describe('Clone submit flow', () => {
  it('POSTs to /admin/memory/clone with the typed target id, scope, and display name', async () => {
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
          target_subject_id: 'fork-1',
          target_display_name: 'Fork experiment',
          clone_scope: 'episodes_and_memories',
          episode_count: 12,
          memory_count: 4,
          source_count: 0,
          cloned_at: '2026-05-03T10:00:00Z',
        }),
      } as Response)
    })

    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    const dialog = await openCloneModal('user-1')

    // Fill form.
    const inputs = within(dialog).getAllByRole('textbox') as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      fireEvent.change(inputs[0], { target: { value: 'fork-1' } })
      fireEvent.change(inputs[1], { target: { value: 'Fork experiment' } })
    })
    await act(async () => {
      fireEvent.change(within(dialog).getByRole('combobox'), {
        target: { value: 'episodes_and_memories' },
      })
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
    expect(parsed.target_subject_id).toBe('fork-1')
    expect(parsed.target_display_name).toBe('Fork experiment')
    expect(parsed.clone_scope).toBe('episodes_and_memories')
  })

  it('fires a "Subject cloned" toast and offers an Open-clone link on success', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'cloned',
          source_subject_id: 'user-1',
          target_subject_id: 'user-1-clone-deadbeef',
          target_display_name: null,
          clone_scope: 'episodes_memories_sources',
          episode_count: 9,
          memory_count: 3,
          source_count: 0,
          cloned_at: '2026-05-03T10:00:00Z',
        }),
      } as Response),
    )

    await act(async () => {
      render(
        <>
          <Toaster position="bottom-right" />
          <SubjectRowActions subjectId="user-1" />
        </>,
      )
    })
    const dialog = await openCloneModal('user-1')
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clone' }))
    })

    // Toast — scope the assertion to sonner's <ol> region so it doesn't
    // collide with the modal's own "Subject cloned" success heading.
    await waitFor(() => {
      const toastList = document.querySelector('ol')
      expect(toastList).not.toBeNull()
      expect(within(toastList as HTMLElement).getByText('Subject cloned')).toBeInTheDocument()
    })

    // Modal-level success: shows new subject id + Open-clone link.
    expect(within(dialog).getByText('user-1-clone-deadbeef')).toBeInTheDocument()
    const link = within(dialog).getByRole('link', { name: /Open clone/i })
    expect(link).toHaveAttribute(
      'href',
      '/subjects/user-1-clone-deadbeef',
    )
  })

  it('shows a 409 target-exists error inside the modal', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 409,
        json: async () => ({
          error: {
            code: 'http_error',
            message:
              "Subject 'fork-1' already has data (12 episodes, 3 memories). Pick a different target id, choose 'merge', or delete the existing subject first.",
          },
        }),
      } as Response),
    )

    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    const dialog = await openCloneModal('user-1')
    const inputs = within(dialog).getAllByRole('textbox') as HTMLInputElement[]
    await act(async () => {
      fireEvent.change(inputs[0], { target: { value: 'fork-1' } })
    })
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Clone' }))
    })

    await waitFor(() => {
      expect(
        within(dialog).getByText(/already has data/i),
      ).toBeInTheDocument()
    })
    // Modal stays open so the operator can fix the input.
    expect(document.querySelector('dialog')).not.toBeNull()
  })

  it('client validation blocks submit when the target id has unsafe characters', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch')
    await act(async () => {
      render(<SubjectRowActions subjectId="user-1" />)
    })
    const dialog = await openCloneModal('user-1')
    const inputs = within(dialog).getAllByRole('textbox') as HTMLInputElement[]
    await act(async () => {
      fireEvent.change(inputs[0], { target: { value: 'has spaces' } })
    })
    const submit = within(dialog).getByRole('button', { name: 'Clone' })
    expect(submit).toBeDisabled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
