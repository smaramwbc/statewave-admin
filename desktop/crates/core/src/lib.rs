//! Shared core for the statewave-admin desktop bundle.
//!
//! Both the CLI bin (`crates/cli`) and the Tauri GUI bin (`crates/gui`) link
//! against this crate. The contract is:
//!   * `client::AdminClient` — typed reqwest client against the admin
//!     server's HTTP surface (the same endpoints the React app hits).
//!   * `config::Credentials` — URL + session cookie persisted via the OS
//!     keychain so GUI sign-in carries over to the CLI and vice versa.
//!   * `swmem` — byte-compatible port of `src/lib/swmem.ts`. Files written
//!     by the GUI's TS implementation must round-trip through this module.

pub mod client;
pub mod config;
pub mod error;
pub mod format;
pub mod swmem;
pub mod types;

pub use client::AdminClient;
pub use config::{BackendCredentials, Config, Credentials};
pub use error::{Error, Result};
