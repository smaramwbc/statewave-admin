use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::types::BulkDeleteFilter;
use statewave_admin_core::AdminClient;

use crate::cli::SubjectsCmd;
use crate::output;
use crate::util::{confirm, encode, qs};

pub async fn run(
    client: &AdminClient,
    cmd: SubjectsCmd,
    format: Format,
    yes: bool,
    quiet: bool,
) -> Result<()> {
    match cmd {
        SubjectsCmd::List {
            search,
            tenant,
            health_state,
            has_open_sessions,
            sort_by,
            sort_order,
            limit,
            offset,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(s) = search {
                q.push(("search", s));
            }
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            if let Some(h) = health_state {
                q.push(("health_state", h));
            }
            if let Some(b) = has_open_sessions {
                q.push(("has_open_sessions", b.to_string()));
            }
            if let Some(s) = sort_by {
                q.push(("sort_by", s));
            }
            if let Some(s) = sort_order {
                q.push(("sort_order", s));
            }
            q.push(("limit", limit.to_string()));
            q.push(("offset", offset.to_string()));
            let v = client.proxy_get(&format!("/admin/subjects{}", qs(&q))).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Show { subject_id, tenant } => {
            let path = format!(
                "/admin/subjects/{}{}",
                encode(&subject_id),
                tenant_qs(tenant.as_deref())
            );
            let v = client.proxy_get(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Memories {
            subject_id,
            tenant,
            status,
            kind,
            search,
            limit,
            offset,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            if let Some(s) = status {
                q.push(("status", s));
            }
            if let Some(k) = kind {
                q.push(("kind", k));
            }
            if let Some(s) = search {
                q.push(("search", s));
            }
            q.push(("limit", limit.to_string()));
            q.push(("offset", offset.to_string()));
            let path = format!(
                "/admin/subjects/{}/memories{}",
                encode(&subject_id),
                qs(&q)
            );
            let v = client.proxy_get(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Episodes {
            subject_id,
            tenant,
            session,
            episode_type,
            search,
            limit,
            offset,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            if let Some(s) = session {
                q.push(("session_id", s));
            }
            if let Some(t) = episode_type {
                q.push(("type", t));
            }
            if let Some(s) = search {
                q.push(("search", s));
            }
            q.push(("limit", limit.to_string()));
            q.push(("offset", offset.to_string()));
            let path = format!(
                "/admin/subjects/{}/episodes{}",
                encode(&subject_id),
                qs(&q)
            );
            let v = client.proxy_get(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Sessions { subject_id, tenant } => {
            let path = format!(
                "/admin/subjects/{}/sla{}",
                encode(&subject_id),
                tenant_qs(tenant.as_deref())
            );
            let v = client.proxy_get(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Timeline {
            subject_id,
            session_id,
            tenant,
        } => {
            let path = format!(
                "/admin/subjects/{}/sessions/{}/timeline{}",
                encode(&subject_id),
                encode(&session_id),
                tenant_qs(tenant.as_deref())
            );
            let v = client.proxy_get(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::Delete { subject_id, tenant } => {
            if !yes {
                let prompt = format!(
                    "Delete subject `{subject_id}` and ALL its episodes + memories? This cannot be undone."
                );
                if !confirm(&prompt)? {
                    output::print_warn("aborted");
                    return Ok(());
                }
            }
            let path = format!(
                "/admin/subjects/{}{}",
                encode(&subject_id),
                tenant_qs(tenant.as_deref())
            );
            let v = client.proxy_delete(&path).await?;
            output::print_value(&v, format);
        }
        SubjectsCmd::BulkDelete {
            prefix,
            older_than_days,
            tenant,
            match_all,
            preview_only,
        } => {
            let filter = BulkDeleteFilter {
                subject_id_prefix: prefix.clone(),
                older_than_days,
                tenant_id: tenant.clone(),
                match_all: if match_all { Some(true) } else { None },
            };
            let preview = client.bulk_delete_preview(&filter).await?;
            if !quiet {
                output::print_hint(&format!(
                    "preview: {} subjects, {} episodes, {} memories",
                    preview.matched, preview.total_episodes, preview.total_memories
                ));
            }
            if preview_only {
                output::print_value(&serde_json::to_value(&preview)?, format);
                return Ok(());
            }
            if preview.matched == 0 {
                output::print_warn("nothing matched the filter — refusing to commit");
                return Ok(());
            }
            if !yes {
                let prompt = format!(
                    "Permanently delete {} subjects (cascading {} episodes + {} memories)?",
                    preview.matched, preview.total_episodes, preview.total_memories
                );
                if !confirm(&prompt)? {
                    output::print_warn("aborted");
                    return Ok(());
                }
            }
            let result = client
                .bulk_delete_commit(&filter, preview.matched)
                .await?;
            output::print_value(&serde_json::to_value(&result)?, format);
        }
        SubjectsCmd::Clone {
            source_subject_id,
            target,
            target_display_name,
            tenant,
            scope,
        } => {
            let body = serde_json::json!({
                "source_subject_id": source_subject_id,
                "target_subject_id": target,
                "target_display_name": target_display_name,
                "target_tenant_id": tenant,
                "clone_scope": scope.unwrap_or_else(|| "episodes_and_memories".into()),
            });
            let v = client.proxy_post("/admin/memory/clone", &body).await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

fn tenant_qs(tenant: Option<&str>) -> String {
    match tenant {
        Some(t) => format!("?tenant_id={}", encode(t)),
        None => String::new(),
    }
}

