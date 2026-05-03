/**
 * Service worker caching-policy tests.
 *
 * The SW is hand-rolled and the safety story is "never cache anything
 * privileged." That story has to survive every refactor or it's a leak.
 *
 * We can't run a real service worker in happy-dom, so we simulate the
 * `self` global the SW expects and execute the SW source directly. The
 * SW file deliberately exposes its `shouldBypass` decision function and
 * its config on `self.__statewaveAdmin*` so this test can exercise the
 * exact same logic the browser SW does.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

interface SwGlobal {
  addEventListener: (...args: unknown[]) => void
  location: { origin: string }
  __statewaveAdminShouldBypass?: (req: FakeRequest, sameOrigin: boolean) => boolean
  __statewaveAdminConfig?: {
    CACHE_VERSION: string
    SHELL_CACHE: string
    SHELL_ASSETS: string[]
    NEVER_CACHE_PREFIXES: string[]
  }
}

interface FakeRequest {
  url: string
  method: string
  cache?: string
  mode?: string
  headers: { get(name: string): string | null }
}

let sw: SwGlobal

beforeAll(() => {
  const swPath = join(resolve(__dirname, '..'), 'public', 'sw.js')
  const source = readFileSync(swPath, 'utf-8')
  // Strip the URL global resolution to a simple shim; happy-dom has it,
  // but we run this under Node where URL is built in. No-op transform
  // — listed for clarity.
  const sandbox: SwGlobal = {
    addEventListener: () => {},
    location: { origin: 'https://admin.example.com' },
  }
  // The SW expects to run as a worker, so we evaluate it with `self`
  // pointing at our sandbox. The handlers register themselves through
  // sandbox.addEventListener (a no-op here) — what we care about is the
  // `self.__statewaveAdmin*` exports landing on the sandbox.
  const fn = new Function('self', 'caches', 'fetch', 'Response', 'URL', source)
  fn(sandbox, undefined, () => undefined, function FakeResponse() {}, URL)
  sw = sandbox
})

function makeRequest(url: string, init: Partial<FakeRequest> = {}): FakeRequest {
  const headers = new Map<string, string>()
  return {
    url,
    method: init.method ?? 'GET',
    cache: init.cache,
    mode: init.mode,
    headers: { get: (n) => headers.get(n.toLowerCase()) ?? null },
  }
}

describe('Service worker — never-cache contract', () => {
  it('exposes its config for inspection', () => {
    expect(sw.__statewaveAdminConfig).toBeDefined()
    expect(sw.__statewaveAdminShouldBypass).toBeInstanceOf(Function)
  })

  it('declares /api/ as a never-cache prefix', () => {
    expect(sw.__statewaveAdminConfig?.NEVER_CACHE_PREFIXES).toContain('/api/')
  })

  it('bypasses every privileged backend route', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    const sensitiveUrls = [
      'https://admin.example.com/api/auth/session',
      'https://admin.example.com/api/auth/login',
      'https://admin.example.com/api/auth/logout',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fsubjects',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fsubjects%2F123%2Fmemories',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fdashboard',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fjobs',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fwebhooks',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Fusage',
      'https://admin.example.com/api/proxy?path=%2Fadmin%2Ftenants',
    ]
    for (const url of sensitiveUrls) {
      expect(bypass(makeRequest(url), true), `expected ${url} to bypass`).toBe(true)
    }
  })

  it('bypasses every non-GET method, even on cacheable paths', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(bypass(makeRequest('https://admin.example.com/index.html', { method }), true)).toBe(true)
    }
  })

  it('bypasses cross-origin requests entirely', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    expect(bypass(makeRequest('https://other.example.com/anything'), false)).toBe(true)
  })

  it('bypasses range requests', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    const req = makeRequest('https://admin.example.com/index.html')
    // patch the headers shim so it returns a Range header
    req.headers = { get: (n) => (n.toLowerCase() === 'range' ? 'bytes=0-1024' : null) }
    expect(bypass(req, true)).toBe(true)
  })

  it('bypasses requests that explicitly opt out via cache: no-store', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    expect(bypass(makeRequest('https://admin.example.com/foo.png', { cache: 'no-store' }), true)).toBe(true)
  })

  it('does NOT bypass safe shell assets so they can be cached', () => {
    const bypass = sw.__statewaveAdminShouldBypass!
    const safe = [
      'https://admin.example.com/index.html',
      'https://admin.example.com/manifest.webmanifest',
      'https://admin.example.com/favicon.svg',
      'https://admin.example.com/icon-192.png',
      'https://admin.example.com/assets/index-abcd1234.js',
    ]
    for (const url of safe) {
      expect(bypass(makeRequest(url), true), `expected ${url} to be cacheable`).toBe(false)
    }
  })

  it('precaches manifest, icons, and offline fallback', () => {
    const shell = sw.__statewaveAdminConfig?.SHELL_ASSETS ?? []
    expect(shell).toContain('/manifest.webmanifest')
    expect(shell).toContain('/icon-192.png')
    expect(shell).toContain('/icon-512.png')
    expect(shell).toContain('/offline.html')
    // The shell should NOT precache anything privileged.
    for (const path of shell) {
      expect(path.startsWith('/api/'), `shell precaches privileged path ${path}`).toBe(false)
    }
  })
})
