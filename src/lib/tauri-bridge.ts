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

export async function clearBackendCredentials(): Promise<void> {
  const invoke = await getInvoke()
  await invoke<void>('clear_backend_credentials')
}

export async function ensureSidecar(): Promise<string> {
  const invoke = await getInvoke()
  return invoke<string>('ensure_sidecar')
}

/**
 * `true` while the React bundle is still on Tauri's `tauri://localhost`
 * custom protocol — we haven't been navigated to the sidecar yet, so
 * this is the bootstrap / wizard phase. Once `ensureSidecar()` runs and
 * the shell calls `webview.navigate`, the document reloads same-origin
 * with the sidecar and `isBootstrapPhase()` returns `false`.
 */
export function isBootstrapPhase(): boolean {
  if (typeof window === 'undefined') return false
  const proto = window.location.protocol
  return proto === 'tauri:' || proto === 'tauri-localhost:'
}
