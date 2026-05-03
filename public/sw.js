/**
 * Statewave Admin — service worker.
 *
 * Hand-rolled, no Workbox. The admin app is privileged: it views memory
 * subjects, runs jobs, lists tenants. A misconfigured service worker
 * would silently leak that data across logins or sessions, so this file
 * is intentionally minimal and the caching policy is strict.
 *
 * Caching policy
 * --------------
 * 1. **App shell (HTML, JS, CSS, favicons, icons, manifest)**: cache-first
 *    with a network-revalidate update path. The whole shell is content-
 *    hashed by Vite, so caching `index.html` along with its assets is
 *    safe and keeps the install fast.
 *
 * 2. **EVERYTHING under `/api/*`**: bypass entirely. Includes
 *    `/api/auth/*` (login, logout, session check) and `/api/proxy/*`
 *    (which fronts every privileged backend admin call — subjects,
 *    memories, episodes, jobs, webhooks, dashboard, usage). These
 *    requests must never sit in a cache: a logged-out user finding
 *    cached subject data after a session ends would be a leak.
 *
 * 3. **Cross-origin requests**: bypass. Anything not on this origin is
 *    routed straight to the network — we never want to intermediate
 *    third-party traffic.
 *
 * 4. **Non-GET methods**: bypass. POST/PATCH/DELETE always hit the
 *    network; service workers should never cache mutations.
 *
 * 5. **Range / partial requests**: bypass. The admin app does not stream
 *    media, but if anything ever does (e.g. logs), partial responses
 *    aren't safe to cache.
 *
 * 6. **Logout**: when the auth-clear endpoint returns OK, every cache is
 *    purged. Belt-and-braces — even though /api/* never enters a cache,
 *    we also drop the shell on logout so a different account signing in
 *    starts from a fresh shell.
 *
 * Update flow
 * -----------
 * - On `install`: precache the known static shell, skip waiting so the
 *   new SW activates without forcing a tab reload.
 * - On `activate`: claim clients and delete any cache key that is not
 *   the current `CACHE_VERSION`.
 * - On `message`: support `{ type: 'SKIP_WAITING' }` for the in-app
 *   "Update available" toast and `{ type: 'CLEAR_CACHE' }` for explicit
 *   cache wipes (e.g. logout, theme reset, support tooling).
 *
 * Bumping the cache
 * -----------------
 * Increment `CACHE_VERSION` on every release. The activate handler will
 * delete every other versioned cache, so users on the previous version
 * get a fresh app shell on next load.
 */

// IMPORTANT: bumping CACHE_VERSION is the canonical way to force every
// installed user onto a new app shell. Tie it to your release pipeline.
const CACHE_VERSION = 'v1'
const SHELL_CACHE = `statewave-admin-shell-${CACHE_VERSION}`

// Precache list — only files we know exist in /public and are safe to
// hold across releases. App bundle JS/CSS in /assets is content-hashed
// by Vite so we cache those opportunistically on first request rather
// than precaching (the file names change every build).
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-192.png',
  '/icon-maskable-512.png',
  '/apple-touch-icon.png',
  '/offline.html',
]

// Path patterns that MUST NEVER be cached. Any request whose URL pathname
// starts with one of these strings bypasses the SW completely.
const NEVER_CACHE_PREFIXES = [
  '/api/',          // every backend call (auth, proxy, admin data)
  '/auth/',         // any direct auth endpoint, if exposed
  '/_session',      // future-proofing — defensive
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => {
      // addAll is atomic — if any URL fails the install fails. The shell
      // list is small and known to exist, so a failure here means a
      // genuine deployment problem rather than a transient hiccup.
      return cache.addAll(SHELL_ASSETS)
    }).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith('statewave-admin-') && key !== SHELL_CACHE)
          .map((key) => caches.delete(key)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting()
    return
  }
  if (data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    )
  }
})

/**
 * Decide whether a given Request should bypass the cache entirely.
 *
 * Returns true for: cross-origin, non-GET, range requests, anything under
 * a privileged path prefix, and anything that explicitly declines cache
 * via the no-store cache mode.
 *
 * Exported (via self.__statewaveAdminShouldBypass) so the registration
 * test in tests/sw-policy.test.ts can run the same logic in Node.
 */
function shouldBypass(request, sameOrigin) {
  if (!sameOrigin) return true
  if (request.method !== 'GET') return true
  if (request.headers.get('range')) return true
  if (request.cache === 'no-store') return true
  const url = new URL(request.url)
  return NEVER_CACHE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
}

self.__statewaveAdminShouldBypass = shouldBypass
self.__statewaveAdminConfig = { CACHE_VERSION, SHELL_CACHE, SHELL_ASSETS, NEVER_CACHE_PREFIXES }

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  if (shouldBypass(request, sameOrigin)) {
    // Explicitly do nothing — let the browser handle the request as if
    // there were no service worker. We do NOT call event.respondWith so
    // we don't accidentally intercept and re-emit a privileged request.
    return
  }

  // Navigation requests (HTML documents) → network-first with shell
  // fallback. This keeps the SPA fresh after a deploy when the user is
  // online and gives them the cached shell when they're offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          // Stash the freshly served HTML for next launch's offline use.
          // We clone before reading because Response bodies can only be
          // consumed once.
          const cache = await caches.open(SHELL_CACHE)
          cache.put('/index.html', fresh.clone()).catch(() => {})
          return fresh
        } catch {
          const cache = await caches.open(SHELL_CACHE)
          const cached = await cache.match('/index.html')
          if (cached) return cached
          const offline = await cache.match('/offline.html')
          if (offline) return offline
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
        }
      })(),
    )
    return
  }

  // Static assets → stale-while-revalidate. Vite content-hashes /assets/*
  // so a stale cache hit is always a correct old build, never a stale
  // version of the current build.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(request)
      const networkPromise = fetch(request)
        .then((response) => {
          // Only cache successful, basic (same-origin) responses. Opaque
          // responses (no-cors) cannot have their status read and can
          // poison the cache, so we refuse them.
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone()).catch(() => {})
          }
          return response
        })
        .catch(() => undefined)
      return cached || (await networkPromise) || new Response('Offline', { status: 503 })
    })(),
  )
})
