/**
 * Thin Tauri bridge — sidecar architecture.
 *
 * In production, the desktop bundle ships a compiled copy of the existing
 * Express admin server (`server/index.ts` → `bun --compile`) as a sidecar
 * binary. On launch the Tauri shell:
 *
 *   1. Loads this React bundle from `tauri://localhost` (Tauri's custom
 *      protocol).
 *   2. We call `get_backend_status` to learn whether the user has saved
 *      `STATEWAVE_API_URL` / `STATEWAVE_API_KEY` (the sidecar needs them
 *      to proxy upstream).
 *   3a. If configured: call `ensure_sidecar` (spawns the binary, returns
 *       its `http://127.0.0.1:NNNN` URL), then navigate the window there.
 *       The React bundle reloads same-origin with the API and behaves
 *       identically to the web deploy — no fetch shim required.
 *   3b. If not configured: render the wizard (collects URL + key), save,
 *       then run step 3a.
 *
 * In dev mode (`cargo tauri dev`) the window is loaded from Vite's
 * dev URL; Vite's middleware serves both the React app and `/api/*`,
 * so no sidecar is involved and this module is mostly a no-op.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown
  }
}

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>

let invokeFn: TauriInvoke | null = null

export function isTauri(): boolean {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__
}

async function getInvoke(): Promise<TauriInvoke> {
  if (invokeFn) return invokeFn
  const mod = await import('@tauri-apps/api/core')
  invokeFn = mod.invoke as TauriInvoke
  return invokeFn
}

export interface BackendStatus {
  configured: boolean
  statewave_api_url: string | null
  sidecar_url: string | null
}

export async function getBackendStatus(): Promise<BackendStatus> {
  const invoke = await getInvoke()
  return invoke<BackendStatus>('get_backend_status')
}

export async function saveBackendCredentials(
  url: string,
  key: string,
): Promise<void> {
  const invoke = await getInvoke()
  await invoke<void>('save_backend_credentials', {
    input: { statewave_api_url: url, statewave_api_key: key },
  })
}

/**
 * Probe the backend before committing credentials. Hits `<url>/readyz`
 * with a 5-second timeout, sends the API key as `X-API-Key` if
 * provided. Throws on any non-2xx or unreachable host so the wizard
 * can surface the error inline.
 */
export async function validateBackend(url: string, key: string): Promise<void> {
  const invoke = await getInvoke()
  await invoke<void>('validate_backend', { url, apiKey: key })
}

export async function clearBackendCredentials(): Promise<void> {
  const invoke = await getInvoke()
  await invoke<void>('clear_backend_credentials')
}

export async function ensureSidecar(): Promise<string> {
  const invoke = await getInvoke()
  return invoke<string>('ensure_sidecar')
}

/**
 * `true` while the React bundle is still on Tauri's bundled
 * frontendDist (booted from the OS-specific Tauri asset URL — varies by
 * platform + version) and has NOT yet been navigated to the sidecar.
 *
 * Detection: in production, the only thing we're sure of is that the
 * sidecar serves the app on `http://127.0.0.1:<port>`. Anything else
 * (`tauri://localhost`, `http://tauri.localhost`, etc.) is the
 * bootstrap phase. We additionally gate on `import.meta.env.PROD` so
 * Vite dev mode (`http://localhost:5173`) doesn't get falsely flagged
 * as bootstrap — in dev the React app runs normally against Vite's
 * `/api/*` middleware and no sidecar is involved.
 *
 * Earlier versions of this function checked `location.protocol ===
 * 'tauri:'` directly. That broke on Windows + Linux (where the asset
 * URL is `http://tauri.localhost`, protocol `http:`) and silently
 * dropped users into the regular `<App />` with no env-var wizard.
 */
export function isBootstrapPhase(): boolean {
  if (typeof window === 'undefined') return false
  if (!import.meta.env.PROD) return false
  return window.location.hostname !== '127.0.0.1'
}
