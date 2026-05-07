use anyhow::Result;
use statewave_admin_core::format::Format;
use statewave_admin_core::AdminClient;

use crate::cli::JobsCmd;
use crate::output;
use crate::util::{confirm, qs};

pub async fn run(
    client: &AdminClient,
    cmd: JobsCmd,
    format: Format,
    yes: bool,
    quiet: bool,
) -> Result<()> {
    match cmd {
        JobsCmd::List {
            status,
            subject,
            tenant,
            limit,
            offset,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(s) = status {
                q.push(("status", s));
            }
            if let Some(s) = subject {
                q.push(("subject_id", s));
            }
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            q.push(("limit", limit.to_string()));
            q.push(("offset", offset.to_string()));
            let v = client.proxy_get(&format!("/admin/jobs{}", qs(&q))).await?;
            output::print_value(&v, format);
        }
        JobsCmd::Purge {
            status,
            subject,
            tenant,
        } => {
            let mut q: Vec<(&str, String)> = Vec::new();
            if let Some(s) = status {
                q.push(("status", s));
            }
            if let Some(s) = subject {
                q.push(("subject_id", s));
            }
            if let Some(t) = tenant {
                q.push(("tenant_id", t));
            }
            if q.is_empty() {
                return Err(anyhow::anyhow!(
                    "purge requires at least one filter (--status, --subject, --tenant)"
                ));
            }
            if !yes && !confirm("Permanently delete the matching compile jobs?")? {
                output::print_warn("aborted");
                return Ok(());
            }
            let v = client
                .proxy_delete(&format!("/admin/jobs{}", qs(&q)))
                .await?;
            if !quiet {
                output::print_ok("purged");
            }
            output::print_value(&v, format);
        }
    }
    Ok(())
}
