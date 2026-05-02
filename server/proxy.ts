/**
 * Runtime-agnostic admin proxy logic.
 *
 * Forwards privileged /admin/* calls from the browser to the Statewave backend
 * while attaching the server-only X-API-Key. Auth must be enforced *before*
 * calling proxyAdminRequest — see api/_lib/auth.ts checkRequestAuth.
 */

export interface ProxyConfig {
  apiUrl: string | null
  apiKey: string | null
}

export interface ProxyInput {
  method: string
  path: string
  body: string | null
  /** Optional per-request identity header (e.g., gateway email). */
  identityEmail?: string | null
}

export interface ProxyOutput {
  status: number
  body: string
  contentType: string
}

export function getProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  return {
    apiUrl: env.STATEWAVE_API_URL ? env.STATEWAVE_API_URL : null,
    apiKey: env.STATEWAVE_API_KEY ? env.STATEWAVE_API_KEY : null,
  }
}

const ALLOWED_PATH_PREFIXES = ['/admin/', '/admin?']
const ALLOWED_PATH_EXACT = ['/admin']

export function isAllowedAdminPath(path: string): boolean {
  if (!path) return false
  if (ALLOWED_PATH_EXACT.includes(path)) return true
  return ALLOWED_PATH_PREFIXES.some((p) => path.startsWith(p))
}

export async function proxyAdminRequest(
  input: ProxyInput,
  cfg: ProxyConfig,
): Promise<ProxyOutput> {
  if (!cfg.apiUrl) {
    return {
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'upstream_not_configured' }),
    }
  }
  if (!isAllowedAdminPath(input.path)) {
    return {
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid_path' }),
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cfg.apiKey) headers['X-API-Key'] = cfg.apiKey
  if (input.identityEmail) {
    headers['X-Statewave-Operator-Email'] = input.identityEmail
  }

  const init: RequestInit = { method: input.method, headers }
  if (input.body !== null && input.body !== undefined) {
    init.body = input.body
  }

  try {
    const upstream = await fetch(`${cfg.apiUrl}${input.path}`, init)
    const text = await upstream.text()
    return {
      status: upstream.status,
      contentType: upstream.headers.get('content-type') ?? 'application/json',
      body: text,
    }
  } catch {
    return {
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'upstream_unreachable' }),
    }
  }
}
