//! Typed structs only where the type matters: auth response, bulk-delete
//! drift contract, the .swmem export payload. Everything else is rendered
//! via `serde_json::Value` to avoid drift with the TS definitions in
//! `src/lib/api.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
pub struct LoginOk {
    #[serde(default)]
    pub ok: Option<bool>,
    #[serde(rename = "authDisabled", default)]
    pub auth_disabled: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct LoginErr {
    pub error: String,
}

#[derive(Debug, Serialize, Default, Clone)]
pub struct BulkDeleteFilter {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_id_prefix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub older_than_days: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub match_all: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkDeleteSample {
    pub subject_id: String,
    pub tenant_id: Option<String>,
    pub episode_count: u64,
    pub memory_count: u64,
    pub last_episode_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkDeletePreview {
    pub matched: u64,
    pub sample: Vec<BulkDeleteSample>,
    pub total_episodes: u64,
    pub total_memories: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkDeleteResult {
    pub deleted_subjects: u64,
    pub deleted_episodes: u64,
    pub deleted_memories: u64,
    #[serde(default)]
    pub failed: Vec<String>,
}

/// Plaintext export payload (what the server returns from
/// `POST /admin/memory/export`). The desktop client AES-GCM encrypts
/// this locally before writing the .swmem file — it never lives on disk
/// in the clear.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryExportPayload {
    pub format: String,
    pub format_version: u32,
    pub export_id: String,
    pub exported_at: String,
    pub export_scope: String,
    #[serde(default)]
    pub subjects: Vec<serde_json::Value>,
    #[serde(default)]
    pub episodes: Vec<serde_json::Value>,
    #[serde(default)]
    pub memories: Vec<serde_json::Value>,
    #[serde(default)]
    pub sources: Vec<serde_json::Value>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}
