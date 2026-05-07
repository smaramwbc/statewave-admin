//! Interactive menu — runs by default when stdin is a tty and no
//! subcommand was provided, or explicitly via `statewave-admin interactive`.
//!
//! Design:
//!   1. On entry: gate on auth. If no stored session, run the login flow
//!      (URL + password prompts) before the menu opens. The menu stays
//!      hidden until we have a usable client.
//!   2. Two-level menu — group → command. Picking a leaf prompts for any
//!      required arguments, then EXECUTES the action against the live
//!      server. The canonical flat invocation is printed as a footer hint
//!      so the user learns the shorthand for next time.
//!   3. After each action returns control to the top-level menu so the
//!      operator can chain operations within one session. "Quit" exits.

use anyhow::{anyhow, Result};
use console::style;
use inquire::Select;
use statewave_admin_core::format::Format;
use statewave_admin_core::{AdminClient, Credentials};

use crate::cli::{
    DiagCmd, EvalCmd, JobsCmd, MemoryCmd, PacksCmd, SmokeCmd, SubjectsCmd, SupportCmd, WebhooksCmd,
};
use crate::handlers;
use crate::index::{groups, in_group, CommandEntry};
use crate::output;

const SEARCH_OPTION: &str = "🔍  Search all commands";
const QUIT_OPTION: &str = "Quit";

pub async fn run() -> Result<()> {
    eprintln!("{}", style("Statewave Admin — interactive").bold());
    eprintln!(
        "{}\n",
        style("Pick a category to drill into commands. Selections execute against the configured admin server.")
            .dim()
    );

    let client = ensure_auth().await?;
    let format = Format::Table;

    loop {
        match top_menu()? {
            TopChoice::Quit => return Ok(()),
            TopChoice::Search => {
                if let Some(entry) = pick_via_search()? {
                    run_entry(&client, entry, format).await?;
                }
            }
            TopChoice::Group(group) => {
                if let Some(entry) = pick_in_group(&group)? {
                    run_entry(&client, entry, format).await?;
                }
            }
        }
        eprintln!();
    }
}

/// Used by `statewave-admin search <query>` (non-interactive). Lists the
/// best matches without executing anything.
pub fn search_and_print(query: &str) {
    let hits = crate::search::rank(query, 8);
    if hits.is_empty() {
        eprintln!("No commands matched.");
        return;
    }
    eprintln!("{}", style("Top matches:").bold());
    for (c, _score) in hits {
        let dest_marker = if c.destructive {
            style(" ⚠").red().to_string()
        } else {
            String::new()
        };
        eprintln!(
            "  {}{}  {}",
            style(format!("statewave-admin {}", c.invocation)).cyan(),
            dest_marker,
            style(c.description).dim()
        );
    }
}

// ─── Auth gate ──────────────────────────────────────────────────────────

async fn ensure_auth() -> Result<AdminClient> {
    if let Ok(creds) = Credentials::load() {
        return Ok(AdminClient::from_credentials(&creds)?);
    }
    eprintln!(
        "{} {}",
        style("·").dim(),
        style("Not signed in — let's connect.").dim()
    );
    handlers::auth::login(None, false).await?;
    let creds = Credentials::load()
        .map_err(|_| anyhow!("login completed but no credentials were stored"))?;
    Ok(AdminClient::from_credentials(&creds)?)
}

// ─── Top-level menu ────────────────────────────────────────────────────

enum TopChoice {
    Quit,
    Search,
    Group(String),
}

fn top_menu() -> Result<TopChoice> {
    let mut entries: Vec<String> = groups().into_iter().map(String::from).collect();
    entries.push(SEARCH_OPTION.into());
    entries.push(QUIT_OPTION.into());
    let pick = Select::new("Category:", entries).prompt();
    match pick {
        Ok(p) if p == QUIT_OPTION => Ok(TopChoice::Quit),
        Ok(p) if p == SEARCH_OPTION => Ok(TopChoice::Search),
        Ok(p) => Ok(TopChoice::Group(p)),
        // ESC / Ctrl-C from inquire → treat as quit
        Err(_) => Ok(TopChoice::Quit),
    }
}

fn pick_in_group(group: &str) -> Result<Option<&'static CommandEntry>> {
    let cmds = in_group(group);
    let labels: Vec<String> = cmds
        .iter()
        .map(|c| {
            if c.destructive {
                format!("{} {} — {}", style("⚠").red(), c.label, c.description)
            } else {
                format!("{} — {}", c.label, c.description)
            }
        })
        .collect();
    let mut all = labels.clone();
    all.push("← Back".into());
    let pick = match Select::new(&format!("{group}:"), all).prompt() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    if pick == "← Back" {
        return Ok(None);
    }
    let idx = labels.iter().position(|l| l == &pick).unwrap_or(0);
    Ok(Some(cmds[idx]))
}

fn pick_via_search() -> Result<Option<&'static CommandEntry>> {
    let q = match inquire::Text::new("Search:")
        .with_help_message("type any words from the command label or description")
        .prompt()
    {
        Ok(s) => s,
        Err(_) => return Ok(None),
    };
    let hits = crate::search::rank(&q, 10);
    if hits.is_empty() {
        output::print_warn("no matches");
        return Ok(None);
    }
    let labels: Vec<String> = hits
        .iter()
        .map(|(c, _)| format!("{} — {}", c.label, c.invocation))
        .collect();
    let mut all = labels.clone();
    all.push("← Back".into());
    let pick = match Select::new("Pick:", all).prompt() {
        Ok(p) => p,
        Err(_) => return Ok(None),
    };
    if pick == "← Back" {
        return Ok(None);
    }
    let idx = labels.iter().position(|l| l == &pick).unwrap_or(0);
    Ok(Some(hits[idx].0))
}

// ─── Per-entry runner ──────────────────────────────────────────────────

async fn run_entry(
    client: &AdminClient,
    entry: &CommandEntry,
    format: Format,
) -> Result<()> {
    eprintln!();
    let outcome = dispatch(client, entry, format).await;
    eprintln!();
    match outcome {
        Ok(()) => {
            eprintln!(
                "{} {}",
                style("·").dim(),
                style(format!("statewave-admin {}", entry.invocation)).dim()
            );
        }
        Err(e) => {
            output::print_err(&format!("{e:#}"));
        }
    }
    Ok(())
}

async fn dispatch(
    client: &AdminClient,
    entry: &CommandEntry,
    format: Format,
) -> Result<()> {
    match entry.invocation {
        // ── Health & overview ─────────────────────────────────────────
        "dashboard" => handlers::overview::dashboard(client, format).await,
        "usage" => {
            let tenant = prompt_optional("Tenant id (blank for global):")?;
            handlers::overview::usage(client, tenant.as_deref(), format).await
        }
        "tenants" => handlers::overview::tenants(client, format).await,
        "smoke status" => handlers::smoke::run(client, SmokeCmd::Status, format).await,
        "smoke run" => {
            if !confirm("Run a fresh smoke check now? It writes a demo episode and triggers a webhook.")? {
                return aborted();
            }
            handlers::smoke::run(client, SmokeCmd::Run, format).await
        }
        "diagnostics personas" => {
            let force = inquire::Confirm::new("Re-run probes (skip cache)?")
                .with_default(false)
                .prompt()
                .unwrap_or(false);
            handlers::diagnostics::run(client, DiagCmd::Personas { force }, format).await
        }

        // ── Subjects & memories ───────────────────────────────────────
        "subjects list" => {
            handlers::subjects::run(
                client,
                SubjectsCmd::List {
                    search: None,
                    tenant: None,
                    health_state: None,
                    has_open_sessions: None,
                    sort_by: None,
                    sort_order: None,
                    limit: 50,
                    offset: 0,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects show" => {
            let id = prompt_required("Subject id:")?;
            let tenant = prompt_optional("Tenant id (blank for any):")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Show {
                    subject_id: id,
                    tenant,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects memories" => {
            let id = prompt_required("Subject id:")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Memories {
                    subject_id: id,
                    tenant: None,
                    status: None,
                    kind: None,
                    search: None,
                    limit: 50,
                    offset: 0,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects episodes" => {
            let id = prompt_required("Subject id:")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Episodes {
                    subject_id: id,
                    tenant: None,
                    session: None,
                    episode_type: None,
                    search: None,
                    limit: 50,
                    offset: 0,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects sessions" => {
            let id = prompt_required("Subject id:")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Sessions {
                    subject_id: id,
                    tenant: None,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects timeline" => {
            let id = prompt_required("Subject id:")?;
            let session = prompt_required("Session id:")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Timeline {
                    subject_id: id,
                    session_id: session,
                    tenant: None,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects delete" => {
            let id = prompt_required("Subject id:")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Delete {
                    subject_id: id,
                    tenant: None,
                },
                format,
                false, // force confirm prompt inside handler
                false,
            )
            .await
        }
        "subjects bulk-delete" => {
            output::print_hint("Pick at least one filter — leave the rest blank.");
            let prefix = prompt_optional("Subject id prefix:")?;
            let older_than_days = prompt_u32("Older-than-days:")?;
            let tenant = prompt_optional("Tenant id:")?;
            let match_all = if prefix.is_none()
                && older_than_days.is_none()
                && tenant.is_none()
            {
                inquire::Confirm::new("No filter set — match ALL subjects?")
                    .with_default(false)
                    .prompt()
                    .unwrap_or(false)
            } else {
                false
            };
            let preview_only = inquire::Confirm::new("Preview only (don't commit)?")
                .with_default(true)
                .prompt()
                .unwrap_or(true);
            handlers::subjects::run(
                client,
                SubjectsCmd::BulkDelete {
                    prefix,
                    older_than_days,
                    tenant,
                    match_all,
                    preview_only,
                },
                format,
                false,
                false,
            )
            .await
        }
        "subjects clone" => {
            let source = prompt_required("Source subject id:")?;
            let target = prompt_optional("Target subject id (blank = auto):")?;
            let target_display_name = prompt_optional("Target display name (blank = none):")?;
            let scope = prompt_optional("Scope (episodes_and_memories | episodes | memories):")?;
            handlers::subjects::run(
                client,
                SubjectsCmd::Clone {
                    source_subject_id: source,
                    target,
                    target_display_name,
                    tenant: None,
                    scope,
                },
                format,
                false,
                false,
            )
            .await
        }

        // ── Compile jobs ──────────────────────────────────────────────
        "jobs list" => {
            handlers::jobs::run(
                client,
                JobsCmd::List {
                    status: None,
                    subject: None,
                    tenant: None,
                    limit: 50,
                    offset: 0,
                },
                format,
                false,
                false,
            )
            .await
        }
        "jobs purge" => {
            output::print_hint("At least one filter is required.");
            let status = prompt_optional("Status (e.g. completed | failed):")?;
            let subject = prompt_optional("Subject id:")?;
            let tenant = prompt_optional("Tenant id:")?;
            handlers::jobs::run(
                client,
                JobsCmd::Purge {
                    status,
                    subject,
                    tenant,
                },
                format,
                false,
                false,
            )
            .await
        }

        // ── Webhooks ──────────────────────────────────────────────────
        "webhooks list" => {
            handlers::webhooks::run(
                client,
                WebhooksCmd::List {
                    status: None,
                    event_type: None,
                    tenant: None,
                    limit: 50,
                    offset: 0,
                },
                format,
                false,
                false,
            )
            .await
        }
        "webhooks purge" => {
            output::print_hint("At least one filter is required.");
            let status = prompt_optional("Status (e.g. delivered | dead_letter):")?;
            let event_type = prompt_optional("Event type:")?;
            let tenant = prompt_optional("Tenant id:")?;
            handlers::webhooks::run(
                client,
                WebhooksCmd::Purge {
                    status,
                    event_type,
                    tenant,
                },
                format,
                false,
                false,
            )
            .await
        }

        // ── Memory portability ────────────────────────────────────────
        "memory packs list" => {
            handlers::memory::run(client, MemoryCmd::Packs(PacksCmd::List), format).await
        }
        "memory packs import" => {
            let pack_id = prompt_required("Pack id:")?;
            let target = prompt_optional("Target subject id (blank = auto):")?;
            let target_display_name = prompt_optional("Target display name (blank = none):")?;
            let conflict_strategy = prompt_optional("Conflict (create_copy | merge | cancel):")?;
            handlers::memory::run(
                client,
                MemoryCmd::Packs(PacksCmd::Import {
                    pack_id,
                    target,
                    target_display_name,
                    tenant: None,
                    conflict_strategy,
                }),
                format,
            )
            .await
        }
        "memory support state" => {
            handlers::memory::run(client, MemoryCmd::Support(SupportCmd::State), format).await
        }
        "memory support reseed" => {
            let reason = prompt_optional("Reason (blank = none):")?;
            let force = inquire::Confirm::new("Force-reseed even if already up-to-date?")
                .with_default(false)
                .prompt()
                .unwrap_or(false);
            if !force
                && !confirm("Reseed Statewave Support subject from the bundled pack?")?
            {
                return aborted();
            }
            handlers::memory::run(
                client,
                MemoryCmd::Support(SupportCmd::Reseed { reason, force }),
                format,
            )
            .await
        }
        "memory export" => {
            let subjects_csv = prompt_required("Subject ids (comma-separated):")?;
            let subject: Vec<String> = subjects_csv
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            if subject.is_empty() {
                return Err(anyhow!("at least one subject id required"));
            }
            let scope = prompt_optional("Scope (episodes_and_memories | …):")?;
            let out = prompt_required("Output file (e.g. /tmp/export.swmem):")?;
            handlers::memory::run(
                client,
                MemoryCmd::Export {
                    subject,
                    tenant: None,
                    scope,
                    out,
                    passphrase_stdin: false,
                },
                format,
            )
            .await
        }
        "memory import" => {
            let file = prompt_required("Path to .swmem file:")?;
            let conflict_strategy = prompt_optional(
                "Conflict (create_copy | merge | cancel) — blank = create_copy:",
            )?;
            handlers::memory::run(
                client,
                MemoryCmd::Import {
                    file,
                    tenant: None,
                    conflict_strategy,
                    passphrase_stdin: false,
                },
                format,
            )
            .await
        }

        // ── Self-healing eval ─────────────────────────────────────────
        "eval status" => handlers::eval::run(client, EvalCmd::Status, format).await,
        "eval run" => {
            let mode = prompt_optional("Mode (smoke | developer | full) — blank = smoke:")?;
            let max_level = prompt_u32("Max level 0..9 (blank = default):")?
                .map(|v| v.min(9) as u8);
            let max_questions = prompt_u32("Max questions (blank = default):")?;
            let subject = prompt_optional("Subject id (blank = demo):")?;
            handlers::eval::run(
                client,
                EvalCmd::Run {
                    mode,
                    max_level,
                    max_questions,
                    subject,
                },
                format,
            )
            .await
        }
        "eval report" => {
            let fmt = prompt_optional("Format (json | markdown) — blank = json:")?
                .unwrap_or_else(|| "json".into());
            handlers::eval::run(client, EvalCmd::Report { format: fmt }, format).await
        }
        "eval grounding" => {
            let subject_id = prompt_required("Subject id:")?;
            handlers::eval::run(
                client,
                EvalCmd::Grounding {
                    subject_id,
                    max_memories: None,
                },
                format,
            )
            .await
        }

        // ── Configuration ─────────────────────────────────────────────
        "auth login" => handlers::auth::login(None, false).await,
        "auth logout" => handlers::auth::logout().await,
        "auth status" => handlers::auth::status().await,
        "config show" => handlers::config_cmd::show(),
        "config path" => handlers::config_cmd::path(),

        other => Err(anyhow!("interactive runner missing for `{other}`")),
    }
}

// ─── small prompt helpers ──────────────────────────────────────────────

fn prompt_required(label: &str) -> Result<String> {
    let s = inquire::Text::new(label).prompt()?;
    if s.trim().is_empty() {
        return Err(anyhow!("a value is required"));
    }
    Ok(s)
}

fn prompt_optional(label: &str) -> Result<Option<String>> {
    let s = inquire::Text::new(label)
        .with_help_message("(leave blank to skip)")
        .prompt()?;
    Ok(if s.trim().is_empty() {
        None
    } else {
        Some(s.trim().to_string())
    })
}

fn prompt_u32(label: &str) -> Result<Option<u32>> {
    match prompt_optional(label)? {
        None => Ok(None),
        Some(s) => Ok(Some(
            s.parse::<u32>()
                .map_err(|_| anyhow!("`{s}` is not a non-negative integer"))?,
        )),
    }
}

fn confirm(prompt: &str) -> Result<bool> {
    Ok(inquire::Confirm::new(prompt)
        .with_default(false)
        .prompt()?)
}

fn aborted() -> Result<()> {
    output::print_warn("aborted");
    Ok(())
}
