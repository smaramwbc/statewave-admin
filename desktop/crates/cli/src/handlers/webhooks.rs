use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::cli::WebhooksCmd;
use crate::output;
use crate::util::{confirm, qs};

pub async fn run(
    client: &AdminClient,
    cmd: WebhooksCmd,
    format: Format,
    yes: bool,
    quiet: bool,
) -> Result<()> {
    match cmd {
        WebhooksCmd::List {
            status,
            event_type,
            tenant,
            limit,
            offset,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(s) = status {
                q.push(("status", s));
            }
            if let Some(t) = event_type {
                q.push(("event_type", t));
            }
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            q.push(("limit", limit.to_string()));
            q.push(("offset", offset.to_string()));
            let v = client
                .proxy_get(&format!("/admin/webhooks{}", qs(&q)))
                .await?;
            output::print_value(&v, format);
        }
        WebhooksCmd::Purge {
            status,
            event_type,
            tenant,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(s) = status {
                q.push(("status", s));
            }
            if let Some(t) = event_type {
                q.push(("event_type", t));
            }
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            if q.is_empty() {
                return Err(anyhow::anyhow!(
                    "purge requires at least one filter (--status, --type, --tenant)"
                ));
            }
            if !yes && !confirm("Permanently delete the matching webhook events?")? {
                output::print_warn("aborted");
                return Ok(());
            }
            let v = client
                .proxy_delete(&format!("/admin/webhooks{}", qs(&q)))
                .await?;
            if !quiet {
                output::print_ok("purged");
            }
            output::print_value(&v, format);
        }
    }
    Ok(())
}
