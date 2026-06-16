/**
 * Connection-info card for the dashboard.
 *
 * Surfaces "what URL is statewave reachable at + how is it configured"
 * so operators don't have to dig through docker-compose / env files to
 * answer that one. Data comes from two endpoints:
 *
 *   - GET /admin/connection-info — backend self-knowledge: version,
 *     schema head, bind config, region, auth state.
 *   - GET /api/admin/proxy-info — admin-server view: the URL the
 *     proxy uses to reach the backend (e.g. `http://api:8100` inside
 *     a docker-compose network).
 *
 * Layered intentionally: the backend doesn't know what hostnames its
 * callers use; the admin proxy does. Each endpoint only knows its
 * half, so the card composes both.
 *
 * Fails open: if either endpoint errors (network blip, backend not
 * upgraded yet), the card hides what it doesn't have and renders
 * what it does. Never blocks the dashboard from loading.
 */
import { useEffect, useState } from 'react'
import { Lock, LockOpen, Server } from 'lucide-react'
import { Badge, Skeleton } from './ui'
import {
  fetchBackendConnectionInfo,
  fetchProxyInfo,
  type BackendConnectionInfo,
  type ProxyInfo,
} from '../lib/settings'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-theme-muted">{label}</div>
      <div className="text-sm text-theme-primary font-mono truncate" title={typeof children === 'string' ? children : undefined}>
        {children}
      </div>
    </div>
  )
}

export function ConnectionInfoCard() {
  const [backend, setBackend] = useState<BackendConnectionInfo | null>(null)
  const [proxy, setProxy] = useState<ProxyInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // Fire both in parallel; one failing doesn't block the other from
    // landing. The dashboard reflows the moment EITHER lands.
    Promise.allSettled([fetchBackendConnectionInfo(), fetchProxyInfo()]).then((results) => {
      if (cancelled) return
      if (results[0].status === 'fulfilled') setBackend(results[0].value)
      if (results[1].status === 'fulfilled') setProxy(results[1].value)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading connection info"
        aria-busy="true"
        className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-4"
      >
        {/* Header row: icon + title + badge */}
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="w-4 h-4 rounded" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-5 w-14 rounded-full ml-1" />
        </div>
        {/* 4-column grid mirroring the actual content */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (!backend && !proxy) {
    // Both failed — silently hide rather than show a half-built card.
    return null
  }

  return (
    <div className="rounded-lg border border-theme-border bg-[var(--theme-card-bg)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <Server className="w-4 h-4 text-theme-muted" />
        <h3 className="text-sm font-medium text-theme-primary">Connection</h3>
        {backend && (
          backend.auth_enabled ? (
            <Badge variant="success">
              <Lock className="w-3 h-3 mr-0.5" /> Auth ON
            </Badge>
          ) : (
            <Badge variant="warning">
              <LockOpen className="w-3 h-3 mr-0.5" /> Auth OFF
            </Badge>
          )
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {proxy?.api_url && (
          <Row label="Backend URL">
            {proxy.api_url}
          </Row>
        )}
        {backend && (
          <Row label="Bind">
            {backend.host}:{backend.port}
          </Row>
        )}
        {backend && (
          <Row label="Version">
            {backend.version}
          </Row>
        )}
        {backend && (
          <Row label="Schema">
            {backend.schema_head}
          </Row>
        )}
        {backend?.region && (
          <Row label="Region">
            {backend.region}
          </Row>
        )}
        {backend && (
          <Row label="Compiler">
            {backend.compiler_type}
          </Row>
        )}
        {backend && (
          <Row label="Embeddings">
            {backend.embedding_provider}
          </Row>
        )}
        {backend && (
          <Row label="Tenancy">
            {backend.require_tenant ? 'required' : 'optional'}
          </Row>
        )}
      </div>
    </div>
  )
}
