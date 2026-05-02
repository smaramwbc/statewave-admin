# statewave-admin

Operator console for Statewave instances — system health, subject explorer, compile jobs, webhook status, and usage metering.

> **Part of the Statewave ecosystem:** [Server](https://github.com/smaramwbc/statewave) · [Python SDK](https://github.com/smaramwbc/statewave-py) · [TypeScript SDK](https://github.com/smaramwbc/statewave-ts) · [Docs](https://github.com/smaramwbc/statewave-docs) · [Examples](https://github.com/smaramwbc/statewave-examples) · [Website + demo](https://statewave.ai) · **Admin**
>
> 📋 **Issues & feature requests:** [statewave/issues](https://github.com/smaramwbc/statewave/issues) (centralized tracker)

> **Frontend role:** This is the **operator/admin console** — a privileged dashboard for monitoring and operating Statewave. For the marketing website and embedded interactive demo, see [statewave-web](https://github.com/smaramwbc/statewave-web).

> ⚠️ **Privileged interface — secure-by-default.** statewave-admin ships with a built-in password gate enabled by default. In production, `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are required; without them, login and `/api/proxy` are blocked. The console is intended for **private deployment** — community users should run their own admin connected to their own backend. `admin.statewave.ai` is private and is not a public demo. For public demos, use [statewave-demo](https://github.com/smaramwbc/statewave-web).

## Screenshots

**Overview** — system readiness, schema/migration state, compile job health, data counts, and rolling usage:

![Overview dashboard](docs/screenshots/overview.png)

**Subjects** — search, filter by health, and drill into per-subject memories, episodes, and SLA state:

![Subjects explorer](docs/screenshots/subjects.png)

## Vendor-neutral by design

Nothing in this repo is bound to a specific cloud or PaaS. The runtime is a small standalone Node HTTP server (zero npm runtime dependencies — only `node:*` built-ins) plus a Vite build of the React UI. Deploy it:

- on any container runtime (Docker, Kubernetes, Nomad, ECS, App Runner, Cloud Run, Render, …)
- on a bare VPS or VM behind nginx / Caddy / Traefik / HAProxy
- on any PaaS that runs Node (no platform-specific config)
- behind any identity-aware proxy (Cloudflare Access, OAuth2 Proxy, AWS ALB + Cognito, IAP, Pomerium, …)

The same auth handlers run in dev (Vite middleware), in tests, and in production. See [DEPLOYMENT.md](DEPLOYMENT.md) for runnable examples per host.

## Quick start (local dev)

```bash
npm install
cp .env.example .env.local
# in .env.local set ADMIN_AUTH_DISABLED=true for local-only dev
npm run dev
```

Open http://localhost:5173. A bright warning banner appears across the top whenever `ADMIN_AUTH_DISABLED=true`.

## Quick start (production-style local)

```bash
npm install
export STATEWAVE_API_URL=http://localhost:8100
export ADMIN_PASSWORD="$(openssl rand -base64 32)"
export ADMIN_SESSION_SECRET="$(openssl rand -hex 32)"
npm run build
npm start
# → http://localhost:8080 — sign in with the password you just generated
```

## Configuration

All variables are **server-side only**. None may use a `VITE_*` prefix — those would be baked into the public bundle.

| Variable | Default | Description |
|----------|---------|-------------|
| `STATEWAVE_API_URL` | _(none)_ | Statewave backend base URL (server-side proxy target) |
| `STATEWAVE_API_KEY` | _(none)_ | API key forwarded as `X-API-Key` to the backend |
| `ADMIN_PASSWORD` | _(none)_ | Required in production unless `ADMIN_AUTH_DISABLED=true` |
| `ADMIN_SESSION_SECRET` | _(none)_ | HMAC secret for signing the session cookie. Required in production unless disabled |
| `ADMIN_SESSION_TTL_HOURS` | `12` | Session cookie lifetime in hours |
| `ADMIN_AUTH_DISABLED` | `false` | Local-dev escape hatch; shows a warning banner when true |
| `ADMIN_TRUST_GATEWAY_HEADERS` | `false` | Accept identity from a fronting proxy (Cloudflare Access etc.) |
| `ADMIN_ALLOWED_EMAILS` | _(empty)_ | Comma-separated allowlist for gateway-supplied emails |
| `PORT` | `8080` | Standalone Node server listen port |
| `HOST` | `0.0.0.0` | Standalone Node server bind host |
| `ADMIN_STATIC_DIR` | `./dist` | Path to the built static frontend |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server + auth middleware in-process |
| `npm run build` | Frontend (`dist/`) + Node server (`dist-server/`) |
| `npm run build:client` | Frontend only |
| `npm run build:server` | Node server only |
| `npm start` | Run the standalone Node server (after build) |
| `npm run preview` | Preview the static frontend (no auth — for asset checks only) |
| `npm test` | Run Vitest |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript across client + server |

## Stack

- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4
- Vitest + Testing Library
- Standalone Node HTTP server with **zero npm runtime dependencies**

## Deployment

statewave-admin is a privileged operator console. Never deploy it publicly without protection. The built-in password gate is the baseline; for team/business use, layer an identity-aware proxy on top.

See [DEPLOYMENT.md](DEPLOYMENT.md) for end-to-end recipes (Docker, Kubernetes, nginx, Caddy, Cloudflare Access, OAuth2 Proxy) and [SECURITY.md](SECURITY.md) for the threat model.
