# Deployment Guide — statewave-admin

## Purpose

`statewave-admin` is an **operator console** for Statewave instances. It provides system health visibility, memory/episode statistics, migration status, compile job monitoring, and webhook diagnostics.

It is **not** a public-facing product. It is an internal tool intended for:

- Platform operators
- DevOps engineers
- On-call teams monitoring a Statewave deployment

In v1, it is designed for **private/internal deployment only**.

---

## Security Model

### Why static frontends cannot safely hold admin secrets

`statewave-admin` is a Vite-built static SPA. Vite's `VITE_*` environment variables are **baked into the JavaScript bundle at build time** via compile-time string replacement. This means:

- Any `VITE_*` value is **visible in the shipped JS source** (View Source, DevTools, CDN cache)
- There is no server-side rendering, no session management, no token exchange
- A `VITE_API_KEY` in a public bundle means anyone who loads the page can extract the key

### Why public deployment without access control is unsafe

If `statewave-admin` were deployed on a public CDN and needed to authenticate against protected `/admin` endpoints, the only option would be embedding an API key in the browser bundle. This would allow **any visitor** to:

- Read all admin data (episodes, memories, subjects, health)
- Call write endpoints (export, import, delete subjects)
- Bypass intended access control entirely

This is equivalent to publishing your admin credentials in your HTML.

### Why private/internal deployment is acceptable in v1

When `statewave-admin` is only accessible from:

- `localhost` (developer's machine)
- A private network (VPN, Tailscale, internal DNS)
- An authenticated reverse proxy

...then no credentials are exposed to the public internet. The backend can run with auth disabled (local dev) or with an API key that only travels over trusted internal networks.

### Why edge auth/gateway is the recommended business path

For production/business use, the recommended approach is an **access gateway** (Cloudflare Access, OAuth2 Proxy, AWS ALB + Cognito, Tailscale ACLs) that:

- Authenticates operators via enterprise SSO (OIDC/SAML)
- Issues a session cookie after identity verification
- Proxies requests to the static frontend and/or backend
- Never exposes credentials to the browser's JavaScript context

This gives full enterprise SSO support (Entra ID, Okta, Google Workspace) with zero custom auth code in `statewave-admin`.

---

## Supported Deployment Modes

### 1. Local-only (localhost)

The default development and operator mode.

```bash
cd statewave-admin
npm run dev        # → http://localhost:5174
```

Backend runs locally with `STATEWAVE_API_KEY` unset (open access).

### 2. Private network / VPN / Tailscale

Deploy as a static site on an internal host. Only accessible to operators on the private network.

```bash
npm run build
# Serve dist/ on an internal host (nginx, caddy, python -m http.server)
```

Backend is on the same private network. API key may be set but only traverses trusted internal links.

### 3. Internal reverse proxy (nginx, Caddy, Traefik)

Place the static site behind a reverse proxy that also proxies `/admin` API calls to the backend. Access is restricted by network policy or basic auth at the proxy level.

### 4. Edge access gateway (recommended for business use)

Deploy the static site behind an identity-aware access gateway:

| Gateway | SSO Support | Cost |
|---------|-------------|------|
| Cloudflare Access | OIDC, SAML (Entra, Okta, Google) | Free <50 users |
| OAuth2 Proxy | Any OIDC provider | Free (self-hosted) |
| Tailscale Funnel + ACLs | Tailscale identity | Free for small teams |
| AWS ALB + Cognito | OIDC, SAML | AWS pricing |

The gateway authenticates operators before they can reach the static site or the backend API.

---

## Recommended v1 Deployment

**Posture:** Private/internal only.

- Run locally or on a private network
- Backend `STATEWAVE_API_KEY` is either unset (local) or set and only accessible internally
- No public internet exposure
- No API keys in browser bundles

This is appropriate for:

- Solo developers running Statewave locally
- Small teams with VPN/Tailscale access to shared infra
- Internal staging environments

## Recommended v2 Deployment

**Posture:** Edge-authenticated access for business/team use.

- Static site deployed to CDN or internal host
- Access gateway (Cloudflare Access or OAuth2 Proxy) authenticates operators via enterprise SSO
- Gateway issues session cookie; browser never sees raw API keys
- Backend optionally validates gateway-injected identity headers for audit logging

**Backend changes needed:** Minimal — optionally trust a gateway-injected header (e.g., `X-Forwarded-User`, `Cf-Access-Authenticated-User-Email`) for audit trails.

---

## Configuration

| Variable | Default | Context | Description |
|----------|---------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:8100` | Build-time | Statewave backend base URL |

### Local development assumptions

- Backend running at `http://localhost:8100`
- `STATEWAVE_API_KEY` unset (open access mode)
- Postgres running locally (via `docker compose up -d db` in the `statewave` repo)

### Private deployment assumptions

- Backend accessible on the same private network
- `VITE_API_BASE_URL` set to internal backend URL at build time
- If `STATEWAVE_API_KEY` is set, the admin frontend sends it via `X-API-Key` header — acceptable only because the network is private

---

## Local Development

```bash
# 1. Start backend (from statewave repo)
cd statewave
docker compose up -d db
uvicorn server.main:app --port 8100

# 2. Start admin dashboard
cd statewave-admin
npm install
npm run dev
# → http://localhost:5174
```

To build for preview:

```bash
npm run build
npm run preview
```

To run tests:

```bash
npm test
```

---

## Safety Checklist

Before any deployment beyond localhost, verify:

- [ ] `statewave-admin` is **not** exposed on a public URL without access control
- [ ] No admin API keys are embedded in `VITE_*` env vars for public builds
- [ ] Backend `/admin` endpoints are protected (API key set, or network-restricted)
- [ ] If deploying for a team, an access gateway or VPN restricts who can reach the UI
- [ ] No sensitive data is cached in public CDN layers without auth gating

---

## What Is Intentionally Not Built Yet

- **No built-in login/session system** — auth happens at the network or gateway layer
- **No OIDC/SAML client code** — enterprise SSO is handled by the access gateway
- **No role-based access control** — all authenticated operators have full visibility
- **No public deployment workflow** — CI/CD for public hosting is deferred until access control is in place

These will be addressed when the product moves to v2 edge-authenticated deployment.
