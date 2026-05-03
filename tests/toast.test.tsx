import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent, within } from '@testing-library/react'
import { Toaster } from 'sonner'
import { SubjectRowActions } from '../src/components/SubjectRowActions'

/**
 * Toast wiring smoke test.
 *
 * We mount the global <Toaster /> next to a real action component
 * (SubjectRowActions), trigger a successful clone, and assert that:
 *   * the matching toast text appears in the toast region
 *   * the toast is rendered by sonner (role=status / aria-live region)
 *
 * This is intentionally minimal — we don't try to enumerate every toast
 * site, only confirm the integration is live and that a representative
 * action surfaces the right copy.
 */

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation((url) => {
    const u = decodeURIComponent(typeof url === 'string' ? url : (url as URL).toString())
    if (u.includes('/admin/memory/clone')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          source_subject_id: 'src-1',
          target_subject_id: 'src-1-copy',
          clone_scope: 'episodes_memories_sources',
          episode_count: 4,
          memory_count: 1,
          source_count: 0,
          status: 'cloned',
          target_display_name: null,
          cloned_at: '2026-05-03T10:00:00Z',
        }),
      } as Response)
    }
    throw new Error(`unexpected fetch in toast test: ${u}`)
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Toast wiring (sonner)', () => {
  it('a successful clone surfaces a "Subject cloned" toast', async () => {
    await act(async () => {
      render(
        <>
          <Toaster position="bottom-right" />
          <SubjectRowActions subjectId="src-1" />
        </>,
      )
    })
    // Open the kebab menu, click Clone subject.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Open subject actions for src-1/ }))
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
    // Sonner mounts toasts in an aria-live region inside an <ol>. The
    // modal's success state ALSO renders "Subject cloned" now, so we scope
    // the assertion to the toast region specifically rather than match
    // anywhere in the document.
    const toastList = await waitFor(() => {
      const ol = document.querySelector('ol[role="region"], section[aria-label*="oti"]')
      // Fall back to any <ol> if sonner's wrapper attrs change between
      // versions — there's only one toast root in the test.
      const root = ol ?? document.querySelector('ol')
      expect(root).not.toBeNull()
      return root as HTMLElement
    })
    await waitFor(() => {
      expect(within(toastList).getByText('Subject cloned')).toBeInTheDocument()
    })
    expect(within(toastList).getByText(/src-1-copy/)).toBeInTheDocument()
  })
})
