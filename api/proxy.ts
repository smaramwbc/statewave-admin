import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Serverless proxy for admin API requests.
 * 
 * The STATEWAVE_API_KEY env var is set in Vercel project settings (server-side only).
 * The STATEWAVE_API_URL env var points to the backend.
 * 
 * Frontend calls: /api/proxy?path=/admin/dashboard
 * This function proxies to: ${STATEWAVE_API_URL}/admin/dashboard with X-API-Key header.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiUrl = process.env.STATEWAVE_API_URL
  const apiKey = process.env.STATEWAVE_API_KEY

  if (!apiUrl) {
    console.info('[statewave-admin] STATEWAVE_API_URL not configured')
    return res.status(500).json({ error: 'STATEWAVE_API_URL not configured' })
  }

  const path = req.query.path as string
  if (!path || !path.startsWith('/admin')) {
    console.info('[statewave-admin] Invalid path:', path)
    return res.status(400).json({ error: 'Invalid path — must start with /admin' })
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (apiKey) {
    headers['X-API-Key'] = apiKey
  }

  // Forward body on write methods. Vercel parses JSON into req.body for us
  // when content-type is application/json — re-serialize for a predictable
  // upstream wire format.
  const method = (req.method || 'GET').toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD' && req.body !== undefined && req.body !== null
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers }
  if (hasBody) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  }

  try {
    console.info('[statewave-admin] Proxying to:', `${method} ${apiUrl}${path}`)
    const upstream = await fetch(`${apiUrl}${path}`, init)

    const body = await upstream.text()
    console.info('[statewave-admin] Upstream response:', upstream.status)
    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json')
    return res.send(body)
  } catch (e) {
    console.info('[statewave-admin] Proxy error:', String(e))
    return res.status(502).json({ error: 'Failed to reach backend', detail: String(e) })
  }
}
