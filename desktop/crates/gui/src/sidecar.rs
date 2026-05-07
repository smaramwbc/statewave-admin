//! Lifecycle for the bundled Node admin server.
//!
//! The sidecar is the existing `server/index.ts` compiled into a single
//! executable via `bun build --compile`. We spawn it on app start with
//! `PORT=0` so the OS picks a free port, then read its stdout for a
//! handshake line shaped `[sidecar-ready] port=NNNN`. The chosen port
//! becomes the URL the main webview is loaded from.
//!
//! The sidecar inherits enough environment to run:
//!   * `STATEWAVE_API_URL` / `STATEWAVE_API_KEY` — backend (set by
//!     the first-run wizard, persisted to the OS keychain).
//!   * `ADMIN_STATIC_DIR` — path to the bundled React `dist` resource.
//!   * `ADMIN_AUTH_DISABLED=true` — the OS keychain is the auth gate
//!     for desktop; the in-server password gate is redundant and only
//!     adds an "enter password" friction for a single-user app.
//!   * `PORT=0`, `HOST=127.0.0.1` — local-only, OS-assigned port.

use anyhow::{anyhow, Result};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::oneshot;

// Base name only — Tauri's `externalBin` declaration carries the
// `binaries/` source prefix; at runtime the binary lives in the app
// bundle's `MacOS/`/`bin/` directory under just the base name.
const SIDECAR_NAME: &str = "statewave-admin-server";
const READY_PREFIX: &str = "[sidecar-ready] port=";
const READY_TIMEOUT_SECS: u64 = 15;

pub struct Sidecar {
    pub url: String,
    pub child: CommandChild,
}

/// Spawn the sidecar with the supplied env, wait for the
/// `[sidecar-ready] port=NNNN` handshake, return the bound URL +
/// the child handle so the caller can kill it on shutdown.
pub async fn spawn(app: &AppHandle) -> Result<Sidecar> {
    let static_dir = resource_static_dir(app)?;

    let mut envs: Vec<(String, String)> = vec![
        ("PORT".into(), "0".into()),
        ("HOST".into(), "127.0.0.1".into()),
        ("ADMIN_STATIC_DIR".into(), static_dir.to_string_lossy().into()),
        ("ADMIN_AUTH_DISABLED".into(), "true".into()),
        ("NODE_ENV".into(), "production".into()),
    ];
    if let Ok(creds) = statewave_admin_core::BackendCredentials::load() {
        envs.push(("STATEWAVE_API_URL".into(), creds.statewave_api_url));
        envs.push(("STATEWAVE_API_KEY".into(), creds.statewave_api_key));
    }

    let cmd = app
        .shell()
        .sidecar(SIDECAR_NAME)
        .map_err(|e| anyhow!("could not resolve sidecar `{SIDECAR_NAME}`: {e}"))?
        .envs(envs);

    let (mut rx, child) = cmd
        .spawn()
        .map_err(|e| anyhow!("could not spawn sidecar: {e}"))?;

    let (tx, port_rx) = oneshot::channel::<u16>();
    let mut tx = Some(tx);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    for line in line.lines() {
                        log::info!("sidecar: {line}");
                        if let Some(rest) = line.strip_prefix(READY_PREFIX) {
                            if let (Some(t), Ok(port)) = (tx.take(), rest.trim().parse::<u16>()) {
                                let _ = t.send(port);
                            }
                        }
                    }
                }
                CommandEvent::Error(e) => log::error!("sidecar error: {e}"),
                CommandEvent::Terminated(payload) => {
                    log::warn!("sidecar terminated: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    let port = tokio::time::timeout(Duration::from_secs(READY_TIMEOUT_SECS), port_rx)
        .await
        .map_err(|_| anyhow!("sidecar didn't emit a `{READY_PREFIX}NNNN` line within {READY_TIMEOUT_SECS}s"))?
        .map_err(|_| anyhow!("sidecar exited before reporting its port"))?;

    Ok(Sidecar {
        url: format!("http://127.0.0.1:{port}"),
        child,
    })
}

fn resource_static_dir(app: &AppHandle) -> Result<PathBuf> {
    // tauri.conf.json maps `../../../dist` → `dist` under the app's
    // resource_dir; resolve that here.
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| anyhow!("could not resolve resource_dir: {e}"))?;
    Ok(resource_dir.join("dist"))
}
