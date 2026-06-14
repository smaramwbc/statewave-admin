/**
 * Tests for the `restartBackend()` + `waitForBackend()` flow that
 * drives the Settings page's "Restart backend" button.
 *
 * The interesting case is `waitForBackend`: it must first see the
 * backend go DOWN, then come back UP — otherwise it false-positives
 * off the still-alive pre-exit window and clears the banner before
 * pending overrides are actually applied.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { restartBackend, waitForBackend } from '../src/lib/settings'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('restartBackend', () => {
  it('POSTs to the proxied /admin/restart and returns the schedule', async () => {
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      // Path is URL-encoded inside the ?path= query of the admin proxy.
      expect(decodeURIComponent(String(url))).toContain('/admin/restart')
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify({ ok: true, exit_in_seconds: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await restartBackend()
    expect(r.exit_in_seconds).toBe(2)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('throws a useful error when the proxy refuses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'nope' }), { status: 403 })),
    )
    await expect(restartBackend()).rejects.toThrow(/nope|HTTP 403/)
  })
})

describe('waitForBackend', () => {
  it('waits for DOWN then UP before resolving', async () => {
    // Sequence: 200 (alive), 503 (going down), 503 (still down), 200 (back).
    // The naive "poll until 200" approach would resolve on the FIRST
    // response and miss the actual restart — this test pins that the
    // implementation correctly waits for the DOWN edge first.
    const responses = [
      new Response('', { status: 200 }),
      new Response('', { status: 503 }),
      new Response('', { status: 503 }),
      new Response('', { status: 200 }),
    ]
    const fetchMock = vi.fn(async () => responses.shift()!)
    vi.stubGlobal('fetch', fetchMock)

    await waitForBackend(5000, 10)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('also recognises a network error as DOWN', async () => {
    // Fly / GCR / k8s ingresses sometimes fail with ECONNRESET rather
    // than a 5xx during the brief unreachable window. Both must count.
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1
        if (call === 1) return new Response('', { status: 200 })
        if (call === 2) throw new Error('ECONNREFUSED')
        return new Response('', { status: 200 })
      }),
    )
    await waitForBackend(5000, 10)
    expect(call).toBeGreaterThanOrEqual(3)
  })

  it('rejects after the timeout if the backend never comes back', async () => {
    // Continuous 503 → DOWN phase passes immediately, UP phase times out.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(waitForBackend(50, 10)).rejects.toThrow(/not come back/i)
  })
})
