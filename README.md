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

## Memory management

All memory operations live on the **Subjects** page — never on the Dashboard. Open Subjects and use the **Import / Restore…** button (top right) for platform-level actions, or the **Clone** / **Export** controls in each subject row for subject-scoped actions.

The features are **vendor-neutral** — no GitHub Actions, Fly.io, or Vercel-specific dependency. Everything routes through the Statewave backend at `/admin/memory/*`.

### Restore Statewave Support

Section A of the Import / Restore drawer. Rebuilds the shared `statewave-support-docs` subject from the bundled `statewave-support-agent` starter pack.

- **Affected subject:** `statewave-support-docs` (the shared docs pack only).
- **Visitor memory is NOT touched.** Per-visitor `demo_web_<uuid>__statewave-support` subjects — the personalisation pool used by the marketing widget's hybrid Support persona — are explicitly excluded.
- **Idempotent.** Every reseed purges existing rows on the target subject before re-importing, so re-running cannot accumulate duplicates.

### Import demo agent memories

Section B of the drawer. Each card represents a bundled platform starter pack — `demo-support-agent`, `demo-coding-assistant`, `demo-sales-copilot`, `demo-devops-agent`, `demo-research-assistant`. Clicking **Import** creates a fresh tenant-owned subject with provenance metadata (`starter_pack_id`, `starter_pack_version`, `imported_at`) on every record. Default conflict strategy: `create_copy` (never overwrites without explicit choice). The `demo-*` pack ids align with the marketing-widget demo personas, so an imported pack is immediately usable from the live demo without renaming.

### Clone subject

Open a subject's row-action kebab on the Subjects page and pick **Clone subject** to fork its memory into a brand-new subject for experiments. The original subject is never mutated.

The modal asks for:

| Field | Notes |
|---|---|
| **Source subject** | Read-only — the row you opened the menu from. |
| **Target subject ID** *(optional)* | Safe characters only (`A–Z a–z 0–9 _ . - :`, max 128 chars). Leave blank to auto-generate (`{source}-clone-<hex>`). |
| **Display name** *(optional)* | Human-readable label stored in metadata. |
| **Clone scope** | One of: |

| Scope | What gets copied |
|---|---|
| `episodes_memories_sources` *(default)* | Every episode + every compiled memory + sources/citations.¹ |
| `episodes_and_memories` | Episodes + compiled memories. |
| `episodes` | Only raw episodes — useful when you want to recompile from scratch. |
| `memories` | Only compiled memories — useful when you want to inspect compiled state without the raw episode trail. |

¹ **Sources/citations are not yet first-class cloneable records.** The scope name is honoured for forward compatibility but the response always reports `source_count: 0` today.

**Provenance** is stamped on every copied record:
- `cloned_from_subject_id` — original subject id
- `cloned_at` — ISO timestamp of the clone operation
- `cloned_by` — operator email (if your admin proxy forwards `X-Statewave-Operator-Email`)
- `original_episode_id` / `original_memory_id` — pre-clone record id

**Errors** surface inline in the modal:
- **400** — invalid input (bad subject id, unsupported scope)
- **404** — source subject not found
- **409** — target subject already has data (pick a different id)

**Export / import is intentionally a separate feature.** This task only ships the in-system clone. The encrypted `.swmem` export / import described below is a related but independent flow.

### Export encrypted `.swmem`

Each row also exposes **Export**, which:

1. Asks for a passphrase + confirmation **in the browser**.
2. Calls `POST /admin/memory/export` for the plaintext payload.
3. **Encrypts client-side** with AES-256-GCM, key derived from the passphrase via PBKDF2-SHA256 (600 000 iterations).
4. Triggers a download of a single `.swmem` file with magic `SWMEM1`.

The passphrase never reaches the server. There is no server-side encryption path.

### Import encrypted `.swmem`

Section C of the drawer. Pick a `.swmem` file from disk, enter the passphrase, and the browser decrypts locally. A preview shows subject / episode / memory counts and original subject ids. Clicking **Import archive** sends the decrypted payload to `POST /admin/memory/import`. By default new subject ids are generated to avoid collisions; the original ids stay in provenance metadata.

### Security model

- **Passphrase never leaves the browser.** Encryption / decryption are pure WebCrypto operations in `src/lib/swmem.ts`. No request body to the backend ever contains the passphrase — there's a regression test for this.
- **Authenticated encryption** (AES-256-GCM). Wrong passphrase and tampered ciphertext both surface as the same user-visible error: *"Wrong passphrase or corrupted file."*
- **Header in cleartext** — `format`, `format_version`, `encryption_algorithm`, `kdf`, `kdf_params`, `salt`, `nonce`, `created_at`. No secrets. The header is what makes future format upgrades (e.g. Argon2id) decodable for old files.
- **Hard limits** on imported size and record counts, configurable via `STATEWAVE_MEMORY_IMPORT_MAX_*` settings.
- **Memory content is never logged.** Server log lines carry subject ids, counts, and pack ids only.
- **Passphrase recovery is impossible.** Statewave cannot decrypt an export without the passphrase. The export modal warns the user.

### `.swmem` file format (v1)

```
bytes  0..5   "SWMEM1"             magic
bytes  6..9   uint32 LE            JSON-header length N
bytes 10..10+N JSON header         encryption metadata, no secrets
bytes 10+N..  ciphertext + GCM tag AEAD-protected payload
```

Header schema (cleartext):

```json
{
  "format": "statewave-memory-export",
  "format_version": 1,
  "encryption_algorithm": "AES-256-GCM",
  "kdf": "PBKDF2-SHA256",
  "kdf_params": { "iterations": 600000, "hash": "SHA-256" },
  "salt": "<base64 16 bytes>",
  "nonce": "<base64 12 bytes>",
  "created_at": "ISO-8601"
}
```

Decrypted payload schema:

```json
{
  "format": "statewave-memory-payload",
  "format_version": 1,
  "export_id": "...",
  "exported_at": "...",
  "export_scope": "episodes_memories_sources",
  "subjects": [...],
  "episodes": [...],
  "memories": [...],
  "sources": [],
  "metadata": {...}
}
```

### Backend configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `STATEWAVE_SUPPORT_SUBJECT_ID` | `statewave-support-docs` | Shared subject id rebuilt by the support reseed action |
| `STATEWAVE_SUPPORT_STARTER_PACK_ID` | `statewave-support-agent` | Starter pack used as the source for support reseed |
| `STATEWAVE_MEMORY_IMPORT_MAX_BYTES` | `52428800` (50 MiB) | Hard cap on a single import payload's serialized size |
| `STATEWAVE_MEMORY_IMPORT_MAX_EPISODES` | `50000` | Per-import episode count cap |
| `STATEWAVE_MEMORY_IMPORT_MAX_MEMORIES` | `50000` | Per-import memory count cap |
| `STATEWAVE_MEMORY_IMPORT_MAX_SUBJECTS` | `100` | Subjects per export / import |

No GitHub PAT or external-service token is required.

### API endpoints

All under `/admin/memory/*`, gated by the existing X-API-Key middleware:

| Method + Path | Purpose |
|---|---|
| `GET  /admin/memory/starter-packs` | List bundled platform packs (manifest metadata only) |
| `POST /admin/memory/starter-packs/import` | Import a bundled pack into a new subject |
| `POST /admin/memory/support/reseed` | Rebuild `statewave-support-docs` (idempotent) |
| `POST /admin/memory/clone` | Clone a subject (refuses to overwrite by default) |
| `POST /admin/memory/export` | Build a versioned plaintext export payload |
| `POST /admin/memory/import` | Ingest a previously decrypted payload |
| `POST /admin/docs-pack/reseed` | **Deprecated alias** — backward-compatible shim for `/admin/memory/support/reseed`. Same body, same response, same vendor-neutral service; kept so older operator scripts keep working. No GitHub token required. |

## Deployment

statewave-admin is a privileged operator console. Never deploy it publicly without protection. The built-in password gate is the baseline; for team/business use, layer an identity-aware proxy on top.

See [DEPLOYMENT.md](DEPLOYMENT.md) for end-to-end recipes (Docker, Kubernetes, nginx, Caddy, Cloudflare Access, OAuth2 Proxy) and [SECURITY.md](SECURITY.md) for the threat model.
