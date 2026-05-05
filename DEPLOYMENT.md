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

# Optional: first-admin-run smoke check
ADMIN_SMOKE_DISABLED=false
ADMIN_SMOKE_STATE_DIR=

# Optional: Self-Healing Eval (admin-triggered LLM evaluation)
ADMIN_SELF_HEALING_EVAL_ENABLED=false
ADMIN_EVAL_LLM_PROVIDER=             # openai | anthropic | openai-compatible
ADMIN_EVAL_LLM_MODEL=
ADMIN_EVAL_LLM_API_KEY=
ADMIN_EVAL_LLM_BASE_URL=             # required for openai-compatible (LiteLLM proxy, Azure-via-LiteLLM, vLLM, …)
ADMIN_DEMO_AGENT_URL=
ADMIN_DEMO_AGENT_API_KEY=
ADMIN_DEMO_AGENT_BODY_FORMAT=default # or "statewave-web" to point at /api/widget-chat
ADMIN_DEMO_AGENT_PERSONA=            # only used by statewave-web shape (default: statewave-support)
ADMIN_DEMO_WEBHOOK_URL=              # reserved / informational in MVP — see README
ADMIN_EVAL_STORAGE_PATH=             # optional persistence directory
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

## First-admin-run smoke check

The **Diagnostics** page (`/diagnostics`) runs a one-time end-to-end validation against the connected backend the first time an authenticated operator opens it. It ingests a tiny demo episode against `subject_id="statewave-demo:first-admin-run"`, triggers an async compile (so the run is visible under `/jobs`), and inspects whether webhook delivery is wired up. The Overview page surfaces a slim banner pointing here only when smoke has never run or the last run failed; on a healthy install Overview stays clean.

- **Endpoints (auth-gated, server-side only):** `GET /api/admin/smoke/status`, `POST /api/admin/smoke/run`.
- **Idempotent:** the demo subject id is fixed, the server single-flights concurrent runs, and the operator can re-trigger it from the **Run smoke check again** button on the Dashboard.
- **Disable:** set `ADMIN_SMOKE_DISABLED=true`. The card renders a neutral "disabled" state and the run endpoint refuses to contact the backend.
- **Persistence:** in-memory by default. Set `ADMIN_SMOKE_STATE_DIR=/var/lib/statewave-admin` (or any writable directory) if you want last-run state to survive restarts.
- **Webhooks not configured?** That is a neutral state, not a failure — the card shows "Webhooks not configured" and the overall status remains success.

See [README.md](README.md#first-admin-run-smoke-check) for the user-facing description.

## Self-Healing Eval

A second card on `/diagnostics` runs an LLM-graded multi-turn eval against a demo support agent. Admin-triggered only — never runs automatically.

- **Disabled by default.** Set `ADMIN_SELF_HEALING_EVAL_ENABLED=true` plus the `ADMIN_EVAL_LLM_*` and `ADMIN_DEMO_AGENT_*` variables to enable. For LiteLLM-proxy or Azure-OpenAI keys, use `ADMIN_EVAL_LLM_PROVIDER=openai-compatible` and set `ADMIN_EVAL_LLM_BASE_URL` to the proxy/gateway URL.
- **Cost.** ~`questions × 2` LLM calls per run (one demo-agent call + one judge call). Defaults: 8 / 20 / 40 questions for smoke / developer / full modes. The card shows the pre-flight estimate before you start.
- **No automatic firing.** Single-flighted server-side; concurrent runs share the same in-flight promise.
- **Storage.** In-memory by default. Set `ADMIN_EVAL_STORAGE_PATH=/var/lib/statewave-admin/eval` to persist redacted JSON reports across restarts.
- **Webhook validation.** `ADMIN_DEMO_WEBHOOK_URL` is reserved / informational in this MVP. The eval reuses the existing Statewave smoke-check path for webhook delivery observation — it inspects whatever destination is configured via `STATEWAVE_WEBHOOK_URL` on the Statewave server.
- **Reports.** JSON + Markdown + a deterministic Copilot improvement prompt. All API keys, bearer tokens, and DB credentials are redacted in stored output.

See [README.md](README.md#self-healing-eval) for the full feature description, levels, and endpoint reference.

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

## PWA / service worker

The admin ships an installable PWA. Behind a reverse proxy a few headers and routes are load-bearing — get them wrong and either updates stop reaching users or static assets are over-cached.

**Routes that must be served from the SPA host (and reach the same Node server):**

- `/sw.js` — the service worker. Must NOT be rewritten or proxied to a different origin.
- `/manifest.webmanifest` — the install contract.
- `/icon-192.png`, `/icon-512.png`, `/icon-maskable-192.png`, `/icon-maskable-512.png`, `/apple-touch-icon.png`, `/favicon.svg` — referenced from the manifest and the document head.
- `/offline.html` — served only when the browser is offline.

**Cache-Control headers the standalone Node server already sets correctly:**

| Path | Cache-Control |
|---|---|
| `/sw.js` | `no-cache, no-store, must-revalidate` |
| `/manifest.webmanifest` | `no-cache, no-store, must-revalidate` |
| `/index.html`, `/`, `/offline.html` | `no-cache, no-store, must-revalidate` |
| `/assets/*` (Vite content-hashed) | `public, max-age=31536000, immutable` |
| Everything else | `public, max-age=300, must-revalidate` |

If you front the admin with nginx / Caddy / a CDN, mirror these. **Never cache `sw.js`** — a CDN-cached SW will pin every user to whatever build was current when the CDN warmed.

**Service worker scope.** `/sw.js` is served with `Service-Worker-Allowed: /` so the SW can intercept the entire origin. Reverse proxies that strip response headers must preserve this one.

**`/api/*` is never cached by the SW.** The SW only touches static assets and the SPA shell. Auth and proxy traffic always reaches the origin live. This is verified by `tests/sw-policy.test.ts`.

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
