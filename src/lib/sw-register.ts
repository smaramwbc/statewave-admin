/**
 * Service worker registration for Statewave Admin.
 *
 * Why hand-rolled instead of `vite-plugin-pwa`:
 *   - The admin SW caching policy is intentionally minimal and the
 *     security review needs every line to be auditable. Workbox-style
 *     route generation hides what's cached and is the wrong default
 *     for a privileged surface.
 *   - We have no offline-first requirement; only an installable shell.
 *
 * What this module does:
 *   1. Skips registration entirely in dev (Vite serves modules; SW would
 *      cache stale `import.meta` chunks).
 *   2. Skips on browsers that don't support service workers — never
 *      throws, just no-ops.
 *   3. Polls for updates on a sane interval and exposes a callback so
 *      the UI can show an "Update available — reload" banner.
 *   4. Provides a `purgeCachesAndUnregister()` exit ramp that the auth
 *      logout flow calls so a different account can sign in cleanly.
 */

export interface RegisterOptions {
  /**
   * Called when a new service worker has been installed and is waiting
   * to take over. UI surfaces a "Reload to update" affordance.
   */
  onUpdateAvailable?: (registration: ServiceWorkerRegistration) => void
}

let activeRegistration: ServiceWorkerRegistration | null = null

export function registerServiceWorker(options: RegisterOptions = {}): void {
  // The Vite client serves modules from /node_modules/.vite at request
  // time; intercepting them with a SW caches stale module graphs and
  // breaks HMR. Production builds ship as plain static assets which is
  // what the SW expects.
  if (import.meta.env.DEV) return

  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  // Defer registration until after first paint so it doesn't compete
  // with the initial render. The SW spec guarantees this is fine —
  // requests already in flight aren't intercepted by a SW that
  // registers later.
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        activeRegistration = registration

        // If there's already a waiting worker at registration time, we
        // missed the install event for it. Notify the caller.
        if (registration.waiting) {
          options.onUpdateAvailable?.(registration)
        }

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          if (!newWorker) return
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // controller exists → there was a previous SW; this is an
              // update, not a first install. Surface to the UI.
              options.onUpdateAvailable?.(registration)
            }
          })
        })

        // Periodic update check. The SW spec also runs an automatic
        // update check on navigation, but admins on long-lived tabs
        // wouldn't otherwise get a fresh build until they reload.
        const ONE_HOUR = 60 * 60 * 1000
        setInterval(() => {
          registration.update().catch(() => {})
        }, ONE_HOUR)
      })
      .catch(() => {
        // Swallow — a failed SW registration must never break the app.
      })
  })

  // When a new SW takes over (after we tell the waiting SW to skip
  // waiting), reload the page so the user gets the new bundle.
  let reloading = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
}

/**
 * Tell the waiting SW to activate immediately. Pair with
 * `onUpdateAvailable` and a "Reload now" UI affordance.
 */
export function applyPendingUpdate(): void {
  const reg = activeRegistration
  if (!reg || !reg.waiting) return
  reg.waiting.postMessage({ type: 'SKIP_WAITING' })
}

/**
 * Wipe every SW cache. Called on logout so a different account doesn't
 * inherit the previous admin's cached shell or settings.
 */
export async function purgeCaches(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  if (!('caches' in window)) return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((k) => caches.delete(k)))
  } catch {
    // best-effort
  }
}

/**
 * Tear down the SW entirely. Used by the logout flow as a defense in
 * depth — even though the SW already bypasses /api/* requests, this
 * removes the service worker altogether so a subsequent user starts
 * with a fresh registration.
 */
export async function purgeCachesAndUnregister(): Promise<void> {
  await purgeCaches()
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return
  try {
    const regs = await navigator.serviceWorker.getRegistrations()
    await Promise.all(regs.map((r) => r.unregister()))
  } catch {
    // best-effort
  }
}
