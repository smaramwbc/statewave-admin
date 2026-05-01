# statewave-admin

Operator console for Statewave instances — system health, subject explorer, compile jobs, webhook status, and usage metering.

> **Part of the Statewave ecosystem:** [Server](https://github.com/smaramwbc/statewave) · [Python SDK](https://github.com/smaramwbc/statewave-py) · [TypeScript SDK](https://github.com/smaramwbc/statewave-ts) · [Docs](https://github.com/smaramwbc/statewave-docs) · [Website + demo](https://statewave.ai) · **Admin**
>
> 📋 **Issues & feature requests:** [statewave/issues](https://github.com/smaramwbc/statewave/issues) (centralized tracker)

> **Frontend role:** This is the **operator/admin console** — internal dashboard for monitoring and operating Statewave. For the marketing website and embedded interactive demo, see [statewave-web](https://github.com/smaramwbc/statewave-web).

## Current capabilities (v0.8)

This is a **read-only admin console** for operators to inspect a running Statewave instance at scale.

| Feature | Status |
|---------|--------|
| System readiness status | ✅ Live |
| Database/migration health | ✅ Live |
| Compile job counts by status | ✅ Live |
| Data counts (subjects, episodes, memories) | ✅ Live |
| Webhook delivery status | ✅ Live |
| Usage metering (rolling windows) | ✅ Live |
| Subject health distribution | ✅ Live |
| **Subject explorer (search/filter)** | ✅ New |
| **Subject detail (memories, episodes, sessions)** | ✅ New |
| **Memory provenance inspection** | ✅ New |
| **Episode timeline** | ✅ New |
| **Health/SLA breakdown** | ✅ New |
| Memory editing / write operations | ❌ Not yet |
| Advanced job management | ❌ Not yet |

### New in v0.8: Subject Explorer

The admin console now includes a full subject explorer for operator inspection:

- **Subject list** with search by ID, filter by health state, and sort options
- **Subject detail page** with:
  - Summary stats (episodes, memories, sessions)
  - Health score breakdown with contributing factors
  - SLA metrics (first response time, resolution time, breaches)
  - Paginated memories list with status filter
  - Paginated episodes timeline with payload inspection
  - Sessions overview

This enables operators to:
- Find any subject quickly by ID search
- Filter subjects by health state (healthy, watch, degraded, critical)
- Drill down into subject details
- Trace memory provenance to source episodes
- Understand health and SLA state

**Design philosophy:** Calm, dense, precise operator UX — not a flashy marketing dashboard.

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
