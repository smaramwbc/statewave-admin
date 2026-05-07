use anyhow::{anyhow, Result};
use std::fs;
use std::io::Read;
use statewave_admin_core::format::Format;
use statewave_admin_core::{swmem, AdminClient};

use crate::cli::{MemoryCmd, PacksCmd, SupportCmd};
use crate::output;

pub async fn run(client: &AdminClient, cmd: MemoryCmd, format: Format) -> Result<()> {
    match cmd {
        MemoryCmd::Packs(p) => packs(client, p, format).await,
        MemoryCmd::Support(s) => support(client, s, format).await,
        MemoryCmd::Export {
            subject,
            tenant,
            scope,
            out,
            passphrase_stdin,
        } => export(client, subject, tenant, scope, out, passphrase_stdin).await,
        MemoryCmd::Import {
            file,
            tenant,
            conflict_strategy,
            passphrase_stdin,
        } => import(client, file, tenant, conflict_strategy, passphrase_stdin, format).await,
    }
}

async fn packs(client: &AdminClient, cmd: PacksCmd, format: Format) -> Result<()> {
    match cmd {
        PacksCmd::List => {
            let v = client.proxy_get("/admin/memory/starter-packs").await?;
            output::print_value(&v, format);
        }
        PacksCmd::Import {
            pack_id,
            target,
            target_display_name,
            tenant,
            conflict_strategy,
        } => {
            let body = serde_json::json!({
                "pack_id": pack_id,
                "target_subject_id": target,
                "target_display_name": target_display_name,
                "target_tenant_id": tenant,
                "conflict_strategy": conflict_strategy,
            });
            let v = client
                .proxy_post("/admin/memory/starter-packs/import", &body)
                .await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

async fn support(client: &AdminClient, cmd: SupportCmd, format: Format) -> Result<()> {
    match cmd {
        SupportCmd::State => {
            let v = client.proxy_get("/admin/memory/support/state").await?;
            output::print_value(&v, format);
        }
        SupportCmd::Reseed { reason, force } => {
            let body = serde_json::json!({
                "reason": reason,
                "force": force,
            });
            let v = client
                .proxy_post("/admin/memory/support/reseed", &body)
                .await?;
            output::print_value(&v, format);
        }
    }
    Ok(())
}

async fn export(
    client: &AdminClient,
    subject_ids: Vec<String>,
    tenant: Option<String>,
    scope: Option<String>,
    out: String,
    passphrase_stdin: bool,
) -> Result<()> {
    let payload = client
        .export_memory(&subject_ids, tenant.as_deref(), scope.as_deref())
        .await?;
    let pass = read_passphrase(passphrase_stdin, true)?;
    let blob = swmem::encrypt(&payload, &pass)?;
    fs::write(&out, &blob)?;
    output::print_ok(&format!(
        "wrote {} ({} bytes, {} subjects, {} episodes, {} memories)",
        out,
        blob.len(),
        payload.subjects.len(),
        payload.episodes.len(),
        payload.memories.len()
    ));
    Ok(())
}

async fn import(
    client: &AdminClient,
    file: String,
    tenant: Option<String>,
    conflict_strategy: Option<String>,
    passphrase_stdin: bool,
    format: Format,
) -> Result<()> {
    let blob = fs::read(&file)?;
    let pass = read_passphrase(passphrase_stdin, false)?;
    let opened = swmem::decrypt(&blob, &pass)?;
    let v = client
        .import_memory(
            &opened.payload,
            tenant.as_deref(),
            conflict_strategy.as_deref(),
        )
        .await?;
    output::print_value(&v, format);
    Ok(())
}

fn read_passphrase(stdin: bool, confirm_match: bool) -> Result<String> {
    if stdin {
        let mut buf = String::new();
        std::io::stdin().read_to_string(&mut buf)?;
        let pass = buf.trim_end_matches(['\n', '\r']).to_string();
        if pass.len() < 8 {
            return Err(anyhow!("passphrase must be at least 8 characters"));
        }
        return Ok(pass);
    }
    let prompt = inquire::Password::new("Passphrase:")
        .with_display_mode(inquire::PasswordDisplayMode::Masked);
    if confirm_match {
        Ok(prompt.prompt()?)
    } else {
        Ok(prompt.without_confirmation().prompt()?)
    }
}
