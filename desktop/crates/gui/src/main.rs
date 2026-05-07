// On Windows: hide the console window when launched from Explorer.
// (The CLI bin lives in a separate crate and stays in the console subsystem.)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use statewave_admin_core::{BackendCredentials, Config};
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{Manager, State};
use tauri_plugin_shell::process::CommandChild;

mod sidecar;

/// Process-wide state. Holds the running sidecar so we can kill it
/// cleanly on shutdown and re-spawn it after the first-run wizard
/// stores the backend credentials.
#[derive(Default)]
struct AppState {
    sidecar: Mutex<Option<CommandChild>>,
    sidecar_url: Mutex<Option<String>>,
}

#[derive(Serialize)]
struct BackendStatus {
    /// `true` once the user has saved both `STATEWAVE_API_URL` and
    /// `STATEWAVE_API_KEY` — the desktop is ready to spawn the sidecar.
    configured: bool,
    /// The configured backend URL (if any) — surfaced in the wizard so
    /// the user can see what was saved.
    statewave_api_url: Option<String>,
    /// Local URL of the running sidecar (`http://127.0.0.1:NNNN`) when
    /// it has been spawned. `None` before first-run completes.
    sidecar_url: Option<String>,
}

#[derive(Deserialize)]
struct SaveBackendInput {
    statewave_api_url: String,
    statewave_api_key: String,
}

// ─── Tauri commands ───────────────────────────────────────────────────

#[tauri::command]
fn get_backend_status(state: State<'_, AppState>) -> BackendStatus {
    let url = Config::load().ok().and_then(|c| c.statewave_api_url);
    let configured = BackendCredentials::is_configured();
    let sidecar_url = state.sidecar_url.lock().ok().and_then(|g| g.clone());
    BackendStatus {
        configured,
        statewave_api_url: url,
        sidecar_url,
    }
}

#[tauri::command]
fn save_backend_credentials(input: SaveBackendInput) -> Result<(), String> {
    let url = input.statewave_api_url.trim().trim_end_matches('/').to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL must start with http:// or https://".into());
    }
    let key = input.statewave_api_key.trim().to_string();
    if key.is_empty() {
        return Err("API key cannot be empty".into());
    }
    BackendCredentials {
        statewave_api_url: url,
        statewave_api_key: key,
    }
    .save()
    .map_err(stringify)
}

#[tauri::command]
fn clear_backend_credentials() -> Result<(), String> {
    BackendCredentials::clear().map_err(stringify)
}

/// Spawn the sidecar and navigate the main webview at it. Idempotent —
/// returns the existing URL on subsequent calls. Called by the React
/// first-run wizard after credentials are saved.
#[tauri::command]
async fn ensure_sidecar(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if let Some(existing) = state.sidecar_url.lock().ok().and_then(|g| g.clone()) {
        return Ok(existing);
    }
    if !BackendCredentials::is_configured() {
        return Err("backend credentials are not configured".into());
    }
    let spawned = sidecar::spawn(&app).await.map_err(stringify)?;
    let url = spawned.url.clone();
    if let Ok(mut guard) = state.sidecar.lock() {
        *guard = Some(spawned.child);
    }
    if let Ok(mut guard) = state.sidecar_url.lock() {
        *guard = Some(url.clone());
    }
    if let Some(window) = app.get_webview_window("main") {
        let parsed: tauri::Url = url.parse().map_err(|e: url::ParseError| e.to_string())?;
        window
            .navigate(parsed)
            .map_err(|e| format!("could not navigate webview: {e}"))?;
        let _ = window.show();
    }
    Ok(url)
}

fn stringify<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn main() {
    env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or("info,statewave_admin_gui=debug"),
    )
    .format_timestamp_secs()
    .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            save_backend_credentials,
            clear_backend_credentials,
            ensure_sidecar,
        ])
        .setup(|app| {
            // Show the window immediately so the React bundle (loaded
            // from Tauri's `tauri://localhost` custom protocol) can
            // render. The bundle's bootstrap calls `get_backend_status`
            // and `ensure_sidecar` via `invoke` — those run on the
            // async runtime where keychain/IO blocking is safe. We
            // deliberately do not touch the keychain in this synchronous
            // setup hook because keychain access from an unsigned `.app`
            // bundle can prompt the user (or hang) and would block the
            // entire app launch.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
            }

            // Native menubar — provides a "Disconnect Backend…" entry
            // so the user can re-run the wizard after install without
            // editing the config file by hand.
            let handle = app.handle();
            let disconnect = MenuItemBuilder::with_id("disconnect", "Disconnect Backend…")
                .build(handle)?;
            let app_submenu = SubmenuBuilder::new(handle, "Statewave Admin")
                .about(None)
                .separator()
                .item(&disconnect)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_submenu = SubmenuBuilder::new(handle, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let menu = MenuBuilder::new(handle)
                .item(&app_submenu)
                .item(&edit_submenu)
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "disconnect" {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut guard) = state.sidecar.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                    if let Ok(mut guard) = state.sidecar_url.lock() {
                        *guard = None;
                    }
                }
                if let Err(e) = BackendCredentials::clear() {
                    log::warn!("clear_backend_credentials: {e}");
                }
                // Reload from the bundled `tauri://localhost` so the
                // wizard re-renders. We don't want to navigate away
                // from a stale sidecar URL because we just killed it.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.eval("window.location.replace('tauri://localhost/')");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut guard) = state.sidecar.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        });
}

