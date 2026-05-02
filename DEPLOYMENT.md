# Deployment Guide — statewave-admin

## What this is

`statewave-admin` is a **privileged operator console**. It exposes the full `/admin/*` surface of a Statewave instance: subject explorer, memory provenance, compile jobs, webhook diagnostics, and bulk-delete tooling. Anyone who reaches it without a credential check has full read/write access to operator data.

For that reason, statewave-admin ships **secure-by-default**:

- A built-in password gate is enabled by default.
- In production, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are **required** — without them, login and `/api/proxy` return `503 auth_not_configured`.
- The escape hatch `ADMIN_AUTH_DISABLED=true` is for local development only and surfaces a visible warning banner in the UI.

The deployment story is **vendor-neutral**: a tiny standalone Node HTTP server (zero npm runtime deps) plus a Vite-built static bundle. Deploy it on any platform that runs Node, behind any reverse proxy, or in any container runtime. There is no platform-specific code, config, or build step.

---

## Threat model in one paragraph

Static SPAs cannot safely hold admin secrets. Anything in a `VITE_*` env var is compiled into the JavaScript bundle and visible to anyone who loads the page. statewave-admin keeps every secret on the server (`/api/proxy`, `/api/auth/*`) and never exposes them to the browser. The browser only ever holds a signed, HttpOnly session cookie. The backend `STATEWAVE_API_KEY`, the admin password, and the session secret never leave the server process.

---

## Required environment

```env
# Backend (server-side only)
STATEWAVE_API_URL=https://your-statewave-backend
STATEWAVE_API_KEY=...

# Built-in password gate (required in production)
ADMIN_PASSWORD=replace-with-long-random-password
ADMIN_SESSION_SECRET=replace-with-32-byte-random-secret
ADMIN_SESSION_TTL_HOURS=12
ADMIN_AUTH_DISABLED=false

# Optional: trust a fronting identity proxy
ADMIN_TRUST_GATEWAY_HEADERS=false
ADMIN_ALLOWED_EMAILS=
```

Generate strong values:

```bash
openssl rand -base64 32   # → ADMIN_PASSWORD
openssl rand -hex 32      # → ADMIN_SESSION_SECRET
```

For local dev only:

```env
ADMIN_AUTH_DISABLED=true
```

A bright warning banner is rendered above the admin UI whenever this is set. Production deployments must never set it.

---

## Deployment Recipes

All recipes use the same artifacts: `dist/` (frontend) and `dist-server/` (Node HTTP server). Build once, deploy anywhere.

### 1. Docker (works on Docker, Kubernetes, ECS, Nomad, Cloud Run, App Runner, Render, fly, Railway, …)

```bash
docker build -t statewave-admin .
docker run -p 8080:8080 \
  -e STATEWAVE_API_URL=https://your-backend \
  -e STATEWAVE_API_KEY=... \
  -e ADMIN_PASSWORD=... \
  -e ADMIN_SESSION_SECRET=... \
  statewave-admin
```

The provided `Dockerfile` is intentionally generic — no platform-specific config. Push the image to whichever registry you use.

### 2. Bare Node (VPS, VM, systemd)

```bash
npm install
npm run build
NODE_ENV=production \
STATEWAVE_API_URL=https://your-backend \
STATEWAVE_API_KEY=... \
ADMIN_PASSWORD=... \
ADMIN_SESSION_SECRET=... \
PORT=8080 \
node dist-server/index.js
```

A minimal systemd unit:

```ini
[Service]
WorkingDirectory=/opt/statewave-admin
EnvironmentFile=/etc/statewave-admin.env
ExecStart=/usr/bin/node dist-server/index.js
Restart=on-failure
User=statewave
[Install]
WantedBy=multi-user.target
```

### 3. Behind nginx (TLS, identity proxy, IP allowlist)

```nginx
server {
  listen 443 ssl http2;
  server_name admin.example.com;

  # Optional: IP allowlist
  allow 10.0.0.0/8;
  deny all;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### 4. Behind Caddy

```caddyfile
admin.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

### 5. Behind any identity-aware proxy (Cloudflare Access, OAuth2 Proxy, AWS ALB + Cognito, GCP IAP, Pomerium, …)

statewave-admin can layer the **built-in password gate** behind a **gateway** that authenticates operators via SSO. Two ways to compose them:

**A) Use the built-in gate only** — proxy passes through, browser sees the login form.
The gateway just enforces network-level access (e.g. corporate IP allowlist, mTLS, SSO).

**B) Trust the gateway's identity** — set `ADMIN_TRUST_GATEWAY_HEADERS=true`. The proxy will accept the gateway's verified identity in lieu of a cookie session, on any of:

- `Cf-Access-Authenticated-User-Email` (Cloudflare Access)
- `X-Forwarded-User` (OAuth2 Proxy, IAP, Pomerium, common reverse proxies)
- `X-Admin-Email` (custom)

Optionally restrict to known operator emails:

```env
ADMIN_TRUST_GATEWAY_HEADERS=true
ADMIN_ALLOWED_EMAILS=alice@example.com,bob@example.com
```

⚠️ Only enable `ADMIN_TRUST_GATEWAY_HEADERS=true` when a trusted upstream actually sets and strips these headers. If exposed directly to the internet, an attacker could spoof them.

### 6. Kubernetes

A standard Deployment + Service + Ingress is sufficient. Mount secrets via a `Secret` and inject as env. Pair with your existing ingress identity layer if you have one.

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: admin
        image: your-registry/statewave-admin:latest
        envFrom:
        - secretRef:
            name: statewave-admin-secrets
        ports:
        - containerPort: 8080
```

### 7. Custom Node host (Express / Connect / Fastify embedding)

The handlers in `server/handlers.ts` are plain Node `(req, res)` functions. Mount them inside your existing Node app:

```ts
import express from 'express'
import { dispatch } from 'statewave-admin/server/handlers'

const app = express()
app.use(async (req, res, next) => {
  if (await dispatch(req, res)) return
  next()
})
```

---

## Composing with external auth layers

Even with the built-in gate, **a fronting identity layer is recommended** for team / business use because it gives you:

- Enterprise SSO (Entra ID, Okta, Google Workspace, …)
- Per-operator identity in audit logs (when `ADMIN_TRUST_GATEWAY_HEADERS=true`)
- Network-level isolation
- IP allowlisting and mTLS

| Layer | Auth model | Typical cost |
|-------|------------|--------------|
| Cloudflare Access | OIDC, SAML, magic-link | Free under 50 users |
| OAuth2 Proxy | Any OIDC provider | Self-hosted, free |
| AWS ALB + Cognito | OIDC, SAML | Per-AWS pricing |
| GCP IAP | Google identity | Per-GCP pricing |
| Tailscale / Tailnet ACLs | Tailscale identity | Free for small teams |
| Pomerium | Any OIDC | Self-hosted, free |
| nginx + auth_request | Anything | Free |
| VPN-only | Network identity | Existing infra |

These compose with — they do not replace — the built-in gate.

---

## Safety checklist (before exposing the admin)

- [ ] `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are set with strong random values.
- [ ] `ADMIN_AUTH_DISABLED` is unset or `false`.
- [ ] `STATEWAVE_API_KEY` is set on the **server** only, never as a `VITE_*` variable.
- [ ] No `VITE_*` variable contains a credential, internal URL, or token.
- [ ] The admin host is not on a public DNS name without a fronting proxy or IP allowlist.
- [ ] If `ADMIN_TRUST_GATEWAY_HEADERS=true`, a trusted reverse proxy strips and replaces the listed headers on every request.
- [ ] `ADMIN_ALLOWED_EMAILS` is set when using the gateway path with multiple users.
- [ ] TLS is terminated upstream (nginx, Caddy, ALB, Cloudflare, …).

---

## Local development

```bash
npm install
cp .env.example .env.local
# Set ADMIN_AUTH_DISABLED=true for unauthenticated local dev.
npm run dev
```

A persistent banner reminds you the gate is off. To rehearse the production gate locally:

```bash
ADMIN_PASSWORD=devpw ADMIN_SESSION_SECRET=devsecret npm run dev
```

---

## What is intentionally not built

- No user registration, database users, roles, or per-user permissions.
- No OAuth/OIDC client. Identity providers are layered above via gateway headers.
- No password reset flow — operators rotate `ADMIN_PASSWORD` server-side.
- No frontend-only auth, no client-side tokens, no `VITE_*` secrets.

These will be reconsidered when there is a clear team-scale need; today the gate + fronting proxy combination covers the common cases.
