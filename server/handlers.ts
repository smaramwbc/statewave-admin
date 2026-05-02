/**
 * Vendor-neutral HTTP handlers for statewave-admin.
 *
 * Plain Node `IncomingMessage` / `ServerResponse` — no `@vercel/node`, no
 * platform-specific helpers. The same handlers are mounted by:
 *
 *   - the standalone Node server  (server/index.ts)
 *   - the Vite dev plugin         (server/vite-plugin.ts)
 *   - or any custom Express/Connect/Fastify host that wires them up.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import {
  checkRequestAuth,
  getAuthConfig,
  loginResult,
  logoutResult,
  sessionResult,
  type RequestLike,
} from './auth.js'
import { getProxyConfig, proxyAdminRequest } from './proxy.js'

export const ROUTES = {
  session: '/api/auth/session',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  proxy: '/api/proxy',
} as const

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function asRequestLike(req: IncomingMessage): RequestLike {
  return { headers: req.headers as RequestLike['headers'] }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: object,
  extra: Record<string, string> = {},
): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export async function handleSession(req: IncomingMessage, res: ServerResponse) {
  const cfg = getAuthConfig()
  const r = sessionResult(asRequestLike(req), cfg)
  sendJson(res, r.status, r.body)
}

export async function handleLogin(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const cfg = getAuthConfig()
  let parsed: unknown
  try {
    const text = await readBody(req)
    parsed = text ? JSON.parse(text) : {}
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' })
  }
  const password = (parsed as { password?: unknown }).password
  const r = loginResult(password, cfg)
  sendJson(res, r.status, r.body, r.setCookie ? { 'Set-Cookie': r.setCookie } : {})
}

export async function handleLogout(req: IncomingMessage, res: ServerResponse) {
  if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' })
  }
  const cfg = getAuthConfig()
  const r = logoutResult(cfg)
  sendJson(res, r.status, r.body, r.setCookie ? { 'Set-Cookie': r.setCookie } : {})
}

export async function handleProxy(req: IncomingMessage, res: ServerResponse) {
  const authCfg = getAuthConfig()
  const auth = checkRequestAuth(asRequestLike(req), authCfg)
  if (!auth.ok) {
    const status = auth.reason === 'misconfigured' ? 503 : auth.status
    const error =
      auth.reason === 'misconfigured' ? 'auth_not_configured' : 'unauthorized'
    return sendJson(res, status, { error })
  }
  const proxyCfg = getProxyConfig()
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.searchParams.get('path') ?? ''
  const method = (req.method ?? 'GET').toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? null : await readBody(req)
  const r = await proxyAdminRequest(
    {
      method,
      path,
      body: body && body.length > 0 ? body : null,
      identityEmail: auth.email ?? null,
    },
    proxyCfg,
  )
  res.statusCode = r.status
  res.setHeader('Content-Type', r.contentType)
  res.end(r.body)
}

/**
 * Single dispatcher — returns true if the request was handled by an admin
 * route, false if the host should serve its own response (e.g. static asset
 * or 404). Vendor-neutral: works behind any Node-based proxy or server.
 */
export async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const p = url.pathname
  if (p === ROUTES.session) {
    await handleSession(req, res)
    return true
  }
  if (p === ROUTES.login) {
    await handleLogin(req, res)
    return true
  }
  if (p === ROUTES.logout) {
    await handleLogout(req, res)
    return true
  }
  if (p === ROUTES.proxy) {
    await handleProxy(req, res)
    return true
  }
  return false
}
