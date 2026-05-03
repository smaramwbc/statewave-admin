import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, act, cleanup, fireEvent } from '@testing-library/react'
import { MemoryActionsDrawer } from '../src/components/MemoryActionsDrawer'
import { encryptSwmem } from '../src/lib/swmem'
import type { MemoryExportPayload, StarterPack } from '../src/lib/api'

/**
 * Subjects-page Import / Restore drawer.
 *
 * Pins the contracts the spec calls out:
 *   * three labelled tabs (Statewave Support / Demo agents / Memory archive)
 *   * the demo-agents tab renders one row per non-support pack
 *   * the .swmem importer (Memory archive tab) asks for a passphrase BEFORE
 *     any backend call
 *   * decrypted payload is sent to /admin/memory/import without the
 *     passphrase ever appearing in the request body
 */

const FAKE_PACKS: StarterPack[] = [
  {
    pack_id: 'statewave-support-agent',
    kind: 'support_docs',
    display_name: 'Statewave Support',
    description: 'Docs starter for Statewave Support persona.',
    version: '1.0.0',
    created_at: '2026-01-01T00:00:00Z',
    subject_id_suggestion: 'statewave-support-docs',
    episode_count: 3,
    memory_count: 3,
    source_count: 0,
    tags: ['starter-pack'],
  },
  {
    pack_id: 'default-support-agent',
    kind: 'demo_agent',
    display_name: 'Default Support Agent',
    description: 'Generic support starter.',
    version: '1.0.0',
    created_at: '2026-01-01T00:00:00Z',
    subject_id_suggestion: 'default-support-agent',
    episode_count: 2,
    memory_count: 2,
    source_count: 0,
    tags: ['starter-pack'],
  },
  {
    pack_id: 'coding-assistant',
    kind: 'demo_agent',
    display_name: 'Coding Assistant',
    description: 'Coding starter.',
    version: '1.0.0',
    created_at: '2026-01-01T00:00:00Z',
    subject_id_suggestion: 'coding-assistant',
    episode_count: 2,
    memory_count: 2,
    source_count: 0,
    tags: ['starter-pack'],
  },
]

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockStarterPacks() {
  return vi.spyOn(global, 'fetch').mockImplementation((url) => {
    const raw = typeof url === 'string' ? url : (url as URL).toString()
    const u = decodeURIComponent(raw)
    if (u.includes('/admin/memory/starter-packs')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ packs: FAKE_PACKS }),
      } as Response)
    }
    throw new Error(`unexpected fetch in drawer test: ${u}`)
  })
}

async function selectTab(name: RegExp) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

describe('MemoryActionsDrawer', () => {
  beforeEach(() => {
    mockStarterPacks()
  })

  it('renders three tabs when opened', async () => {
    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    // Tab triggers use exact-match names so they don't collide with the
    // "Restore Statewave Support" action button visible on the default tab.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Statewave Support$/ })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /^Demo agents/ })).toBeInTheDocument()
    // Tab label intentionally calls out encryption so operators see the
    // .swmem section is the encrypted archive flow, not just any importer.
    expect(
      screen.getByRole('button', { name: /^Encrypted memory archive$/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Memory actions never reset visitor memories/i),
    ).toBeInTheDocument()
  })

  it('Demo agents tab lists one row per non-support pack', async () => {
    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await selectTab(/Demo agents/)
    await waitFor(() => {
      expect(screen.getByText('Default Support Agent')).toBeInTheDocument()
    })
    expect(screen.getByText('Coding Assistant')).toBeInTheDocument()
    // Two demo packs → two Import buttons in this tab.
    const importButtons = screen.getAllByRole('button', { name: /^Import$/ })
    expect(importButtons.length).toBe(2)
  })

  it('Memory archive tab asks for a passphrase before any backend call', async () => {
    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await selectTab(/Encrypted memory archive/)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument()
    })
    // Inline note must explain client-side decryption AND warn that lost
    // passphrases cannot be recovered. Both properties are part of the
    // .swmem security contract — losing either confuses operators about
    // what Statewave does and does not control.
    expect(
      screen.getByText(/Passphrase is never sent to Statewave; lost passphrases cannot be recovered/i),
    ).toBeInTheDocument()
  })
})

describe('.swmem import flow — passphrase isolation', () => {
  it('decrypted payload is sent to /admin/memory/import WITHOUT the passphrase', async () => {
    // Pre-build a real encrypted .swmem so the round-trip exercises the
    // actual crypto path (no mocks for WebCrypto).
    const passphrase = 'super-secret-pass-1234'
    const payload: MemoryExportPayload = {
      format: 'statewave-memory-payload',
      format_version: 1,
      export_id: 'exp-xyz',
      exported_at: '2026-05-01T00:00:00Z',
      export_scope: 'episodes_memories_sources',
      subjects: [{ original_subject_id: 'src-1', metadata: {} }],
      episodes: [{ subject_id: 'src-1', payload: { hi: true } }],
      memories: [{ subject_id: 'src-1', kind: 'fact', content: 'remembered fact' }],
      sources: [],
      metadata: {},
    }
    const blob = await encryptSwmem(payload, passphrase)
    const file = new File([blob.buffer as ArrayBuffer], 'archive.swmem', {
      type: 'application/octet-stream',
    })

    const captured: Array<{ url: string; body: string }> = []
    vi.spyOn(global, 'fetch').mockImplementation((url, init) => {
      const raw = typeof url === 'string' ? url : (url as URL).toString()
      const u = decodeURIComponent(raw)
      if (u.includes('/admin/memory/starter-packs')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ packs: FAKE_PACKS }),
        } as Response)
      }
      if (u.includes('/admin/memory/import')) {
        captured.push({ url: raw, body: (init?.body as string) ?? '' })
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            imported_at: '2026-05-03T00:00:00Z',
            export_id: 'exp-xyz',
            conflict_strategy: 'create_copy',
            subject_id_map: { 'src-1': 'src-1-copy' },
            imported_subjects: ['src-1-copy'],
            imported_episodes: 1,
            imported_memories: 1,
            imported_sources: 0,
          }),
        } as Response)
      }
      throw new Error(`unexpected fetch: ${u}`)
    })

    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await selectTab(/Encrypted memory archive/)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument()
    })

    // Drop the file in.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Passphrase'), {
        target: { value: passphrase },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Decrypt & preview/i }))
    })

    await waitFor(() => {
      expect(screen.getByText(/Decrypted preview/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText('1').length).toBeGreaterThan(0)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import archive/i }))
    })

    await waitFor(() => {
      expect(captured.length).toBe(1)
    })
    const sentBody = captured[0].body
    expect(sentBody).not.toContain(passphrase)
    const parsed = JSON.parse(sentBody)
    expect(parsed.payload?.format).toBe('statewave-memory-payload')
    expect(parsed.payload?.export_id).toBe('exp-xyz')
  })
})

describe('.swmem UX copy contract', () => {
  /**
   * Pins the four user-facing properties the security model depends on:
   *   1. The section is labelled as encrypted (not just "memory archive")
   *   2. Encryption / decryption happens in the browser
   *   3. The passphrase is not sent to Statewave
   *   4. Lost passphrases cannot be recovered (no server-side recovery path)
   *
   * Also pins the negative invariants — no vendor mentions, no
   * "coming soon", no disabled state.
   */
  beforeEach(() => {
    mockStarterPacks()
  })

  it('archive tab is named "Encrypted memory archive" and explains the security model', async () => {
    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^Encrypted memory archive$/ }),
      ).toBeInTheDocument()
    })
    await selectTab(/Encrypted memory archive/)

    // (2) Client-side decryption — required helper copy.
    expect(screen.getByText(/Decryption happens entirely in your browser/i)).toBeInTheDocument()
    // (3) Passphrase isolation. The phrase intentionally appears in
    // multiple places (modal description + tab blurb + inline note next to
    // the Decrypt button) — each one targets a different reading path
    // (skim header / read intro / look at the action). Asserting ≥1 keeps
    // the test honest without forcing a single canonical location.
    expect(screen.getAllByText(/passphrase is never sent to Statewave/i).length).toBeGreaterThan(0)
    // (4) No-recovery warning — must say it explicitly, not imply.
    expect(
      screen.getAllByText(/(archive cannot be recovered|cannot be recovered)/i).length,
    ).toBeGreaterThan(0)
  })

  it('does not advertise the .swmem flow as disabled, coming soon, or vendor-tied', async () => {
    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await selectTab(/Encrypted memory archive/)

    // Negative regression — none of these strings should appear anywhere
    // in the drawer copy. They were considered during the release pass and
    // explicitly rejected: .swmem ships live, vendor-neutral, and is not a
    // preview feature.
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Fly\.io|Vercel|GitHub Actions|GITHUB_TOKEN/)).not.toBeInTheDocument()

    // The Decrypt & preview button must be reachable (not behind a "disabled
    // for now" guard) — disabled is allowed only when there's no file +
    // passphrase yet, which is the normal idle state.
    const btn = screen.getByRole('button', { name: /Decrypt & preview/i })
    expect(btn).toBeInTheDocument()
  })
})

describe('Wrong-passphrase decrypt flow', () => {
  it('shows the standard error message when the passphrase does not match', async () => {
    const blob = await encryptSwmem(
      {
        format: 'statewave-memory-payload',
        format_version: 1,
        export_id: 'x',
        exported_at: '2026-05-01T00:00:00Z',
        export_scope: 'episodes_memories_sources',
        subjects: [],
        episodes: [],
        memories: [],
        sources: [],
        metadata: {},
      },
      'right-passphrase-1234',
    )
    const file = new File([blob.buffer as ArrayBuffer], 'archive.swmem', {
      type: 'application/octet-stream',
    })

    mockStarterPacks()

    await act(async () => {
      render(<MemoryActionsDrawer open={true} onClose={() => {}} />)
    })
    await selectTab(/Encrypted memory archive/)
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Passphrase')).toBeInTheDocument()
    })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } })
    })
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Passphrase'), {
        target: { value: 'WRONG-passphrase-XXXX' },
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Decrypt & preview/i }))
    })
    await waitFor(() => {
      expect(screen.getByText(/Wrong passphrase or corrupted file\./i)).toBeInTheDocument()
    })
  })
})
