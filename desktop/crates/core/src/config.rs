//! On-disk config (server URL) + OS-keychain-backed session cookie.
//!
//! Layout:
//!   * URL → TOML at `<config_dir>/statewave-admin/config.toml`
//!   * Cookie → OS keychain, service `statewave-admin`, user `<url>`
//!
//! GUI and CLI share both. Either side can write the credentials and the
//! other will pick them up on next launch.

use crate::error::{Error, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const KEYRING_SERVICE: &str = "statewave-admin";
const ENV_URL: &str = "STATEWAVE_ADMIN_URL";
const ENV_COOKIE: &str = "STATEWAVE_ADMIN_COOKIE";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    /// Base URL of the admin server the CLI talks to,
    /// e.g. `https://admin.statewave.io`.
    pub url: Option<String>,
    /// Default output format if `--json`/`--yaml`/`--table` is not set.
    #[serde(default)]
    pub default_format: Option<String>,
    /// Backend Statewave API URL passed to the desktop GUI's embedded
    /// sidecar (`STATEWAVE_API_URL`).
    #[serde(default)]
    pub statewave_api_url: Option<String>,
    /// Backend Statewave API key passed to the embedded sidecar
    /// (`STATEWAVE_API_KEY`). Stored in the same TOML rather than the
    /// OS keychain because keychain access from an unsigned `.app`
    /// bundle prompts the user (or hangs); the file lives under the
    /// user-private `<config_dir>/io.statewave.statewave-admin/`
    /// directory which already has the same threat model. A future
    /// signed-build pass can move this back to the keychain.
    #[serde(default)]
    pub statewave_api_key: Option<String>,
}

impl Config {
    pub fn load() -> Result<Self> {
        let path = config_path()?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(&path)?;
        Ok(toml::from_str(&raw)?)
    }

    pub fn save(&self) -> Result<()> {
        let path = config_path()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&path, toml::to_string_pretty(self)?)?;
        Ok(())
    }

    pub fn path() -> Result<PathBuf> {
        config_path()
    }
}

/// What the CLI/GUI need to call the admin server: the URL and the
/// already-signed `sw_admin_session` cookie value.
#[derive(Debug, Clone)]
pub struct Credentials {
    pub url: String,
    pub cookie: String,
}

impl Credentials {
    /// Resolve credentials in this order:
    ///   1. `STATEWAVE_ADMIN_URL` + `STATEWAVE_ADMIN_COOKIE` env vars
    ///      (intended for CI / headless servers).
    ///   2. Config file URL + keychain cookie entry keyed on that URL.
    pub fn load() -> Result<Self> {
        if let (Ok(url), Ok(cookie)) = (std::env::var(ENV_URL), std::env::var(ENV_COOKIE)) {
            if !url.is_empty() && !cookie.is_empty() {
                return Ok(Self { url, cookie });
            }
        }
        let cfg = Config::load()?;
        let url = cfg
            .url
            .or_else(|| std::env::var(ENV_URL).ok().filter(|s| !s.is_empty()))
            .ok_or(Error::NoServerUrl)?;
        let cookie = read_cookie(&url)?.ok_or(Error::NotAuthenticated)?;
        Ok(Self { url, cookie })
    }

    /// Persist URL to config file and cookie to OS keychain.
    pub fn save(&self) -> Result<()> {
        let mut cfg = Config::load().unwrap_or_default();
        cfg.url = Some(self.url.clone());
        cfg.save()?;
        write_cookie(&self.url, &self.cookie)?;
        Ok(())
    }

    /// Best-effort wipe: clear the keychain entry. The config file's URL
    /// is preserved so the user only re-enters the password, not the URL.
    pub fn clear() -> Result<()> {
        if let Ok(cfg) = Config::load() {
            if let Some(url) = cfg.url {
                let _ = delete_cookie(&url);
            }
        }
        Ok(())
    }
}

fn config_path() -> Result<PathBuf> {
    let dirs = ProjectDirs::from("io", "statewave", "statewave-admin")
        .ok_or_else(|| Error::Other("could not resolve config directory".into()))?;
    Ok(dirs.config_dir().join("config.toml"))
}

fn keyring_entry(url: &str) -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(KEYRING_SERVICE, url)?)
}

fn read_cookie(url: &str) -> Result<Option<String>> {
    match keyring_entry(url)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn write_cookie(url: &str, cookie: &str) -> Result<()> {
    keyring_entry(url)?.set_password(cookie)?;
    Ok(())
}

fn delete_cookie(url: &str) -> Result<()> {
    match keyring_entry(url)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

// ─── Backend (Statewave API) credentials for the desktop sidecar ─────
//
// `BackendCredentials` is what the GUI's embedded admin server needs to
// proxy requests to the live Statewave API: a URL + API key. Both are
// persisted to the same `config.toml` rather than the OS keychain — see
// the comment on `Config::statewave_api_key` for the reasoning.

#[derive(Debug, Clone)]
pub struct BackendCredentials {
    pub statewave_api_url: String,
    pub statewave_api_key: String,
}

impl BackendCredentials {
    pub fn load() -> Result<Self> {
        let cfg = Config::load().unwrap_or_default();
        let url = cfg
            .statewave_api_url
            .ok_or_else(|| Error::Other("backend URL not configured".into()))?;
        let key = cfg
            .statewave_api_key
            .ok_or_else(|| Error::Other("backend API key not configured".into()))?;
        Ok(Self {
            statewave_api_url: url,
            statewave_api_key: key,
        })
    }

    pub fn save(&self) -> Result<()> {
        let mut cfg = Config::load().unwrap_or_default();
        cfg.statewave_api_url = Some(self.statewave_api_url.clone());
        cfg.statewave_api_key = Some(self.statewave_api_key.clone());
        cfg.save()
    }

    pub fn clear() -> Result<()> {
        if let Ok(mut cfg) = Config::load() {
            cfg.statewave_api_url = None;
            cfg.statewave_api_key = None;
            let _ = cfg.save();
        }
        Ok(())
    }

    pub fn is_configured() -> bool {
        let cfg = match Config::load() {
            Ok(c) => c,
            Err(_) => return false,
        };
        cfg.statewave_api_url
            .as_deref()
            .is_some_and(|s| !s.is_empty())
            && cfg
                .statewave_api_key
                .as_deref()
                .is_some_and(|s| !s.is_empty())
    }
}
