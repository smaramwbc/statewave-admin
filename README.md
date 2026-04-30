# statewave-admin

Operator console for Statewave instances — system health, compile jobs, webhook status, and usage metering.

> **Part of the Statewave ecosystem:** [Server](https://github.com/smaramwbc/statewave) · [Python SDK](https://github.com/smaramwbc/statewave-py) · [TypeScript SDK](https://github.com/smaramwbc/statewave-ts) · [Docs](https://github.com/smaramwbc/statewave-docs) · [Demo](https://statewave-demo.vercel.app) · **Admin**

> **Frontend role:** This is the **operator/admin console** — internal dashboard for monitoring and operating Statewave. For the marketing website, see [statewave-web](https://github.com/smaramwbc/statewave-web). For the interactive demo, see [statewave-demo](https://github.com/smaramwbc/statewave-demo).

## Current capabilities (v0.7 early)

This is an **early read-only admin surface**. It provides visibility into a running Statewave instance:

| Feature | Status |
|---------|--------|
| System readiness status | ✅ Live |
| Database/migration health | ✅ Live |
| Compile job counts by status | ✅ Live |
| Data counts (subjects, episodes, memories) | ✅ Live |
| Webhook delivery status | ✅ Live |
| Usage metering (rolling windows) | ✅ Live |
| Subject health distribution | ✅ Live |
| Memory editing / write operations | ❌ Not yet |
| Advanced job management | ❌ Not yet |

**Honest status:** This is a v1 read-only operator dashboard. It shows what's happening but doesn't yet support write operations or advanced administration tasks.

> **⚠️ Security Notice:** This is an internal/operator tool intended for **private deployment only**. Do not deploy publicly without an access gateway (Cloudflare Access, OAuth2 Proxy, or equivalent enterprise SSO layer). See [DEPLOYMENT.md](DEPLOYMENT.md) for the full security model and deployment guide.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5174

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:8100` | Statewave API base URL |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server on port 5174 |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview production build |
| `npm test` | Run tests with Vitest |
| `npm run lint` | ESLint check |

## Stack

- Vite 8 + React 19 + TypeScript
- Tailwind CSS v4
- Vitest + Testing Library

## Deployment

This app is designed for **private/internal deployment**. Do not expose on the public internet without an authenticated access gateway.

For local use:

```bash
npm run build
npm run preview
```

For team/business deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).
