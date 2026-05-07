//! Reqwest client for the admin server.
//!
//! Auth: the admin server's existing `sw_admin_session` HMAC cookie
//! (`statewave-admin/server/auth.ts`). The CLI POSTs to `/api/admin/login`
//! to mint one and then sends `Cookie: sw_admin_session=<value>` on every
//! call. No new server endpoint is involved.
//!
//! Path shape: writes against the admin API go through `/api/proxy?path=…`
//! exactly like the React app does. Direct admin endpoints (smoke,
//! self-healing-eval, persona-health) are reached at `/api/admin/...` and
//! `/api/self-healing-eval/...`.

use crate::error::{Error, Result};
use crate::types::{
    BulkDeleteFilter, BulkDeletePreview, BulkDeleteResult, MemoryExportPayload,
};
use reqwest::header::{HeaderMap, HeaderValue, COOKIE};
use reqwest::{Method, Response};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;
use url::form_urlencoded;

const SESSION_COOKIE: &str = "sw_admin_session";

/// Stored in place of a real cookie when the server has
/// `ADMIN_AUTH_DISABLED=true`. The server short-circuits the auth check
/// before verifying the cookie HMAC, so any value travels safely.
pub const AUTH_DISABLED_SENTINEL: &str = "__AUTH_DISABLED__";

#[derive(Debug, Clone)]
pub struct AdminClient {
    inner: reqwest::Client,
    base: url::Url,
    cookie: Option<String>,
}

impl AdminClient {
    /// Construct a client that has a base URL but no authenticated session
    /// yet. Useful for the login flow itself.
    pub fn anonymous(base_url: &str) -> Result<Self> {
        Self::build(base_url, None)
    }

    /// Construct a fully-loaded client (URL + session cookie).
    pub fn from_credentials(creds: &crate::Credentials) -> Result<Self> {
        Self::build(&creds.url, Some(creds.cookie.clone()))
    }

    fn build(base_url: &str, cookie: Option<String>) -> Result<Self> {
        let base = url::Url::parse(base_url.trim_end_matches('/'))?;
        let inner = reqwest::Client::builder()
            .user_agent(concat!("statewave-admin/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(60))
            .build()?;
        Ok(Self {
            inner,
            base,
            cookie,
        })
    }

    pub fn base_url(&self) -> &url::Url {
        &self.base
    }

    pub fn has_session(&self) -> bool {
        self.cookie.is_some()
    }

    // ─── Auth ──────────────────────────────────────────────────────────

    /// POST `/api/auth/login` with the password. Captures the
    /// `sw_admin_session` cookie from the `Set-Cookie` response header
    /// (the server's `makeSessionCookie` helper sets `HttpOnly` + path=/,
    /// see `server/auth.ts`).
    ///
    /// When the server has `ADMIN_AUTH_DISABLED=true` the response is
    /// `{ ok: true, authDisabled: true }` with no `Set-Cookie`. We accept
    /// that and store a sentinel cookie value (`__AUTH_DISABLED__`) so
    /// the rest of the client doesn't need to treat the disabled case
    /// specially — the server's `checkRequestAuth` short-circuits on
    /// `authDisabled` before ever validating the cookie HMAC.
    pub async fn login(&mut self, password: &str) -> Result<()> {
        let url = self.base.join("/api/auth/login")?;
        let res = self
            .inner
            .post(url)
            .json(&serde_json::json!({ "password": password }))
            .send()
            .await?;
        let status = res.status();
        let cookie = extract_session_cookie(res.headers());
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            return Err(Error::AuthFailed(format!(
                "HTTP {} — {}",
                status,
                shorten(&body)
            )));
        }
        if let Some(c) = cookie {
            self.cookie = Some(c);
            return Ok(());
        }
        // No cookie returned — only acceptable when the server is in
        // auth-disabled mode.
        let body: Value = res.json().await.unwrap_or(Value::Null);
        let auth_disabled = body
            .get("authDisabled")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if auth_disabled {
            self.cookie = Some(AUTH_DISABLED_SENTINEL.to_string());
            return Ok(());
        }
        Err(Error::AuthFailed(
            "server did not return a session cookie".into(),
        ))
    }

    pub fn session_cookie(&self) -> Option<&str> {
        self.cookie.as_deref()
    }

    /// Calls `/api/auth/session` to confirm the cookie is still valid.
    pub async fn session_status(&self) -> Result<Value> {
        self.json_request(Method::GET, "/api/auth/session", None::<&()>)
            .await
    }

    pub async fn logout(&mut self) -> Result<()> {
        // Server clears the cookie on its side; we drop ours regardless.
        let _ = self
            .json_request::<_, Value>(Method::POST, "/api/auth/logout", None::<&()>)
            .await;
        self.cookie = None;
        Ok(())
    }

    // ─── Proxy convenience ─────────────────────────────────────────────
    //
    // Wraps `/api/proxy?path=<encoded>` so callers can write
    // `client.proxy_get("/admin/dashboard").await?`.

    pub async fn proxy_get(&self, admin_path: &str) -> Result<Value> {
        self.json_request::<_, Value>(Method::GET, &proxy_url(admin_path), None::<&()>)
            .await
    }

    pub async fn proxy_post<B: Serialize>(
        &self,
        admin_path: &str,
        body: &B,
    ) -> Result<Value> {
        self.json_request::<_, Value>(Method::POST, &proxy_url(admin_path), Some(body))
            .await
    }

    pub async fn proxy_delete(&self, admin_path: &str) -> Result<Value> {
        self.json_request::<_, Value>(Method::DELETE, &proxy_url(admin_path), None::<&()>)
            .await
    }

    // ─── Direct admin endpoints (smoke, eval, persona-health) ──────────
    //
    // These live at `/api/admin/...` and `/api/self-healing-eval/...` and
    // do NOT go through `/api/proxy?path=`. Authenticated by the same
    // session cookie.

    pub async fn get_raw(&self, path: &str) -> Result<Value> {
        self.json_request::<_, Value>(Method::GET, path, None::<&()>)
            .await
    }

    pub async fn post_raw<B: Serialize>(&self, path: &str, body: &B) -> Result<Value> {
        self.json_request::<_, Value>(Method::POST, path, Some(body))
            .await
    }

    pub async fn get_raw_delete(&self, path: &str) -> Result<Value> {
        self.json_request::<_, Value>(Method::DELETE, path, None::<&()>)
            .await
    }

    // ─── Subjects (typed for drift-protected bulk delete) ──────────────

    pub async fn bulk_delete_preview(
        &self,
        filter: &BulkDeleteFilter,
    ) -> Result<BulkDeletePreview> {
        let v = self
            .proxy_post("/admin/subjects/preview-delete", filter)
            .await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn bulk_delete_commit(
        &self,
        filter: &BulkDeleteFilter,
        expected_count: u64,
    ) -> Result<BulkDeleteResult> {
        let mut body = serde_json::to_value(filter)?;
        if let Some(map) = body.as_object_mut() {
            map.insert("expected_count".into(), expected_count.into());
            map.insert("confirm".into(), true.into());
        }
        let v = self
            .proxy_post("/admin/subjects/bulk-delete", &body)
            .await?;
        Ok(serde_json::from_value(v)?)
    }

    // ─── Memory portability ────────────────────────────────────────────

    pub async fn export_memory(
        &self,
        subject_ids: &[String],
        tenant_id: Option<&str>,
        export_scope: Option<&str>,
    ) -> Result<MemoryExportPayload> {
        let body = serde_json::json!({
            "subject_ids": subject_ids,
            "tenant_id": tenant_id,
            "export_scope": export_scope,
        });
        let v = self.proxy_post("/admin/memory/export", &body).await?;
        Ok(serde_json::from_value(v)?)
    }

    pub async fn import_memory(
        &self,
        payload: &MemoryExportPayload,
        target_tenant_id: Option<&str>,
        conflict_strategy: Option<&str>,
    ) -> Result<Value> {
        let body = serde_json::json!({
            "payload": payload,
            "target_tenant_id": target_tenant_id,
            "conflict_strategy": conflict_strategy,
        });
        self.proxy_post("/admin/memory/import", &body).await
    }

    // ─── Generic JSON request ──────────────────────────────────────────

    async fn json_request<B, R>(
        &self,
        method: Method,
        path: &str,
        body: Option<&B>,
    ) -> Result<R>
    where
        B: Serialize + ?Sized,
        R: for<'de> serde::Deserialize<'de>,
    {
        let url = self.base.join(path)?;
        let mut req = self.inner.request(method, url).headers(self.headers());
        if let Some(b) = body {
            req = req.json(b);
        }
        let res = req.send().await?;
        decode_json(res).await
    }

    fn headers(&self) -> HeaderMap {
        let mut h = HeaderMap::new();
        if let Some(c) = &self.cookie {
            if let Ok(val) = HeaderValue::from_str(&format!("{SESSION_COOKIE}={c}")) {
                h.insert(COOKIE, val);
            }
        }
        h
    }
}

fn proxy_url(admin_path: &str) -> String {
    // Mirrors `adminUrl(path)` in `src/lib/api.ts`: the entire admin path
    // (including any query string) gets URL-encoded into the `path` param.
    let encoded: String =
        form_urlencoded::byte_serialize(admin_path.as_bytes()).collect();
    format!("/api/proxy?path={encoded}")
}

fn extract_session_cookie(headers: &HeaderMap) -> Option<String> {
    for value in headers.get_all(reqwest::header::SET_COOKIE).iter() {
        let s = match value.to_str() {
            Ok(v) => v,
            Err(_) => continue,
        };
        // `Set-Cookie: sw_admin_session=<value>; HttpOnly; Path=/; ...`
        let prefix = format!("{SESSION_COOKIE}=");
        if let Some(rest) = s.strip_prefix(&prefix) {
            let value = rest.split(';').next().unwrap_or("").trim();
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}

async fn decode_json<R>(res: Response) -> Result<R>
where
    R: for<'de> serde::Deserialize<'de>,
{
    let status = res.status();
    if status.is_success() {
        return Ok(res.json::<R>().await?);
    }
    let body = res.text().await.unwrap_or_default();
    Err(Error::Server {
        status: status.as_u16(),
        body: shorten(&body),
    })
}

fn shorten(s: &str) -> String {
    // Surface JSON `error.message` / `detail` if present, else clip raw text.
    if let Ok(v) = serde_json::from_str::<Value>(s) {
        if let Some(msg) = v
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
        {
            return msg.to_string();
        }
        if let Some(msg) = v.get("error").and_then(|e| e.as_str()) {
            return msg.to_string();
        }
        if let Some(msg) = v.get("detail").and_then(|m| m.as_str()) {
            return msg.to_string();
        }
    }
    if s.len() > 240 {
        format!("{}…", &s[..240])
    } else {
        s.to_string()
    }
}
