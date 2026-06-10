# Statewave Admin Desktop

Single-binary cross-platform desktop client for the Statewave admin server, alongside a standalone CLI. Both produced from one Cargo workspace.

- **`Statewave Admin.app` / `.exe` / `.AppImage`** — Tauri v2 shell that wraps the existing React admin UI in [`../src/`](../src/). The shell **embeds the standalone Node admin server** (`server/index.ts` compiled with `bun build --compile`) and runs it as a sidecar at `127.0.0.1:<random-port>`. The webview is then loaded from that URL — no remote admin server is required, no extra service for the user to manage.
- **`statewave-admin`** — cross-platform CLI (Windows console-subsystem `.exe`, macOS / Linux ELF). Talks HTTP to any admin server (the one inside the desktop bundle, a self-hosted deployment, or your team's hosted admin URL). Discoverable via an interactive menu and fuzzy `search`, scriptable via flat subcommands.

Both link against the same `crates/core` library: HTTP client, config storage, output formatters, and the byte-compatible `.swmem` AES-GCM crypto port of [`../src/lib/swmem.ts`](../src/lib/swmem.ts).

## Layout

```
desktop/
├── Cargo.toml                          ← workspace root
├── crates/
│   ├── core/                           ← lib: HTTP client, config, swmem, format
│   ├── cli/                            ← bin: statewave-admin              (console subsystem)
│   └── gui/                            ← bin: statewave-admin-gui          (Tauri v2, windows subsystem)
│       ├── binaries/                   ← bun-compiled sidecar (gitignored)
│       │   └── statewave-admin-server-<rust-target-triple>
│       ├── capabilities/default.json   ← Tauri v2 permission manifest
│       └── tauri.conf.json
├── scripts/
│   └── build-sidecar.sh                ← `bun build --compile` per target
└── rust-toolchain.toml
```

## How the sidecar bundling works

```
┌─ Statewave Admin.app ─────────────────────────────────────────┐
│                                                               │
│  Contents/MacOS/                                              │
│   ├─ statewave-admin-gui          ← Tauri shell (~6 MB)       │
│   └─ statewave-admin-server       ← bun-compiled sidecar (58 MB)
│                                                               │
│  Contents/Resources/                                          │
│   └─ dist/                        ← React build (the UI)      │
│                                                               │
│  At launch the shell:                                         │
│   1. spawns the sidecar with `PORT=0` + the saved             │
│      `STATEWAVE_API_URL` / `STATEWAVE_API_KEY` env vars       │
│   2. parses the `[sidecar-ready] port=NNNN` handshake on      │
│      stdout to learn the OS-assigned port                     │
│   3. navigates the main webview to `http://127.0.0.1:NNNN`    │
│                                                               │
│  The webview now runs same-origin against the sidecar — the   │
│  React app's existing relative `/api/*` calls hit the         │
│  embedded admin server with no fetch shim. The sidecar in     │
│  turn proxies `/api/proxy?path=…` to the real Statewave API.  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

The sidecar is `bun build --compile`'d from the unmodified [server/index.ts](../server/index.ts) — every server change reaches both the web deploy and the desktop bundle from the same source. Per-target build via:

```sh
npm run build:sidecar              # host triple only (fast iteration)
npm run build:sidecar:all          # all release targets (CI)
```

## First run

The user-facing flow:

1. Drag the `.app` to `/Applications`. Double-click. Tauri shell launches.
2. The webview loads from `tauri://localhost`. No backend creds are stored, so the bundle's [TauriFirstRun.tsx](../src/components/TauriFirstRun.tsx) wizard renders.
3. User pastes their Statewave **API URL** + **API key** → "Connect".
4. The shell writes `~/Library/Application Support/io.statewave.statewave-admin/config.toml` (per-OS user config dir), spawns the sidecar with those values as env, and navigates the webview to `http://127.0.0.1:<sidecar-port>`. The dashboard loads.

To switch backends or wipe credentials: **Statewave Admin → Disconnect Backend…** in the menubar. Wipes the config, kills the sidecar, returns to the wizard.

### Why config file, not OS keychain (for now)

The API key lives in the per-user config file rather than the OS keychain. Reason: keychain access from an **unsigned** `.app` bundle prompts the user (or hangs the launch) because the system can't match the bundle's code-signing identity to the keychain item's ACL. Once the desktop build is signed + notarized (Apple Developer ID or equivalent on Windows), we can move the key back to the keychain — `crates/core/src/config.rs` has a TODO marker for that pass.

The config file is still under `~/Library/Application Support/<id>/`, so its file permissions are user-restricted by the OS — same threat model as a `.env` file on the same machine.

## CLI

The `statewave-admin` binary is independent of the desktop. It speaks HTTP to any admin server: a self-hosted [server/index.ts](../server/index.ts) deployment, a Vercel deploy, or — if you start the desktop GUI and read the port from the menu/config — that local sidecar.

```sh
statewave-admin auth login --url https://admin.example.com
statewave-admin                     # interactive menu (auto-prompts login if needed)
statewave-admin search "delete subject"
statewave-admin subjects bulk-delete --prefix bulkmm_ --preview-only
```

Auth uses the existing `/api/auth/login` cookie (see [server/auth.ts](../server/auth.ts)) — no new server endpoint was added for CLI use. Both the cookie and the desktop's backend creds are isolated per profile in the OS keychain (CLI cookies) or config TOML (desktop API key). They don't collide.

## Building

Prerequisites: Rust stable (`rustup install stable`), Node 22+, and **[bun](https://bun.sh) 1.x** for sidecar compilation. macOS additionally needs Xcode CLT for the WebKit linker.

```sh
# from the repo root
npm install

# CLI only — no Tauri / WebKit deps required
cd desktop
cargo build -p statewave-admin-cli --release
./target/release/statewave-admin --help

# Full desktop bundle (host platform)
cd ..
npm run build:client
npm run build:sidecar              # produces desktop/crates/gui/binaries/...
cd desktop
cargo tauri build                  # produces .app + .dmg / .msi / .deb / .AppImage

# GUI dev with hot reload (no sidecar — Vite serves the API)
cargo tauri dev
```

Tauri's `beforeBuildCommand` wiring is intentionally **not** in `tauri.conf.json` — it ran with a different cwd than `cargo tauri build` from the workspace and produced bewildering path errors. The recipe above (`build:client` + `build:sidecar` + `cargo tauri build`) is what the release CI runs explicitly.

## Auth model

| Where        | Auth flavor                                 | Where the secret lives                                              |
|--------------|---------------------------------------------|---------------------------------------------------------------------|
| Web deploy   | `ADMIN_PASSWORD` + HMAC `sw_admin_session` cookie | server env var; cookie in browser                                |
| CLI          | reuses the same cookie via `/api/auth/login`     | OS keychain (`statewave-admin` service)                          |
| Desktop GUI  | `ADMIN_AUTH_DISABLED=true` — the OS user is the gate | per-user config TOML; key isolated to your macOS / Windows user |

The desktop is locally-bound (sidecar listens on `127.0.0.1` only). Adding a password layer on top of OS-level user isolation would just be a friction tax — the in-app `AuthGate` suppresses the "auth disabled" warning banner under Tauri so the user isn't told something misleading.

## `.swmem` interop

`crates/core/src/swmem.rs` is byte-for-byte compatible with [src/lib/swmem.ts](../src/lib/swmem.ts) (PBKDF2-SHA256/600k → AES-256-GCM, magic `SWMEM1` + LE u32 header length). Round-trip tests in `cargo test --workspace --lib` exercise both directions.

## Distribution

[`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml) fires on tags shaped `desktop-v*`. The workflow:

1. Per matrix runner: `npm ci`, `npm run build:client`, `bash desktop/scripts/build-sidecar.sh` for the matching target triple.
2. `tauri-apps/tauri-action` produces the GUI bundles (`.dmg` + `.msi` + `.deb` + `.AppImage`).
3. The standalone CLI binary is uploaded to the same release.

| OS              | GUI bundle                                | CLI binary attached to the release |
|-----------------|-------------------------------------------|------------------------------------|
| `windows-latest`| NSIS / MSI installer (`Statewave Admin`)  | `statewave-admin-cli-windows-x64.exe` |
| `macos-latest`  | `.dmg` (Apple Silicon; Intel Macs run it via Rosetta 2) | `statewave-admin-cli-macos-arm64`     |
| `ubuntu-latest` | `.deb` + `.AppImage`                      | `statewave-admin-cli-linux-x64`    |

Code signing is opt-in via repo secrets (`APPLE_CERTIFICATE`, `APPLE_ID`, etc.) — when absent the workflow still completes and produces unsigned bundles.

## Testing

```sh
cd desktop
cargo test --workspace                      # core lib + format + swmem round-trip
cargo run -p statewave-admin-cli -- --help
cargo run -p statewave-admin-cli -- search "delete subject"

# typecheck & test the React side that ships in the GUI
cd ..
npm run typecheck
npm test
```
