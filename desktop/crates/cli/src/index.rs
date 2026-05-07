//! Static command index.
//!
//! Single source of truth for the interactive menu and fuzzy search.
//! Hand-maintained alongside `cli.rs` — the trade-off vs. reflecting clap
//! at runtime is that the menu copy can be richer and grouped by intent
//! instead of by clap structure.

#[derive(Debug, Clone, Copy)]
pub struct CommandEntry {
    /// Menu group title.
    pub group: &'static str,
    /// Short label shown in menus.
    pub label: &'static str,
    /// One-line description shown next to the label.
    pub description: &'static str,
    /// Canonical flat invocation, e.g. `subjects bulk-delete`.
    pub invocation: &'static str,
    /// Whether this command can mutate / delete state.
    pub destructive: bool,
}

pub const COMMANDS: &[CommandEntry] = &[
    // Health & overview
    CommandEntry {
        group: "Health & overview",
        label: "Dashboard",
        description: "Readiness, migration, counts (one-shot).",
        invocation: "dashboard",
        destructive: false,
    },
    CommandEntry {
        group: "Health & overview",
        label: "Usage windows",
        description: "Episode / memory / job counts for today, 7d, 30d.",
        invocation: "usage",
        destructive: false,
    },
    CommandEntry {
        group: "Health & overview",
        label: "Tenants",
        description: "List the tenants the admin can see.",
        invocation: "tenants",
        destructive: false,
    },
    CommandEntry {
        group: "Health & overview",
        label: "Smoke status",
        description: "Last first-run smoke check result.",
        invocation: "smoke status",
        destructive: false,
    },
    CommandEntry {
        group: "Health & overview",
        label: "Run smoke",
        description: "Trigger a fresh first-run smoke check.",
        invocation: "smoke run",
        destructive: false,
    },
    CommandEntry {
        group: "Health & overview",
        label: "Persona health",
        description: "Demo-pack persona retrieval probes.",
        invocation: "diagnostics personas",
        destructive: false,
    },
    // Subjects & memories
    CommandEntry {
        group: "Subjects & memories",
        label: "List subjects",
        description: "Paginated list with filters.",
        invocation: "subjects list",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Subject detail",
        description: "Summary, health, SLA for one subject.",
        invocation: "subjects show",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Subject memories",
        description: "Memory rows for a subject.",
        invocation: "subjects memories",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Subject episodes",
        description: "Episode rows for a subject.",
        invocation: "subjects episodes",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Subject sessions",
        description: "Open + resolved sessions, SLA breaches.",
        invocation: "subjects sessions",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Session timeline",
        description: "Full event timeline for one session.",
        invocation: "subjects timeline",
        destructive: false,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Delete subject",
        description: "Cascades to all episodes + memories. Irreversible.",
        invocation: "subjects delete",
        destructive: true,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Bulk-delete subjects",
        description: "Filter → preview → commit with drift protection.",
        invocation: "subjects bulk-delete",
        destructive: true,
    },
    CommandEntry {
        group: "Subjects & memories",
        label: "Clone subject",
        description: "Copy episodes/memories into a new subject.",
        invocation: "subjects clone",
        destructive: false,
    },
    // Jobs
    CommandEntry {
        group: "Compile jobs",
        label: "List jobs",
        description: "Compile jobs with filters.",
        invocation: "jobs list",
        destructive: false,
    },
    CommandEntry {
        group: "Compile jobs",
        label: "Purge jobs",
        description: "Bulk-delete terminal compile jobs.",
        invocation: "jobs purge",
        destructive: true,
    },
    // Webhooks
    CommandEntry {
        group: "Webhooks",
        label: "List webhook events",
        description: "Webhook delivery events with filters.",
        invocation: "webhooks list",
        destructive: false,
    },
    CommandEntry {
        group: "Webhooks",
        label: "Purge webhook events",
        description: "Bulk-delete terminal webhook events.",
        invocation: "webhooks purge",
        destructive: true,
    },
    // Memory portability
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "List starter packs",
        description: "Built-in / bundled packs available to import.",
        invocation: "memory packs list",
        destructive: false,
    },
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "Import starter pack",
        description: "Seed a subject from a starter pack.",
        invocation: "memory packs import",
        destructive: false,
    },
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "Support subject state",
        description: "Live vs. bundled Support pack version + counts.",
        invocation: "memory support state",
        destructive: false,
    },
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "Reseed Support",
        description: "Reseed the Support subject from the bundled pack.",
        invocation: "memory support reseed",
        destructive: true,
    },
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "Export memory (.swmem)",
        description: "Encrypt subjects to a passphrase-protected archive.",
        invocation: "memory export",
        destructive: false,
    },
    CommandEntry {
        group: "Memory portability (.swmem)",
        label: "Import memory (.swmem)",
        description: "Decrypt + import a `.swmem` archive.",
        invocation: "memory import",
        destructive: false,
    },
    // Eval
    CommandEntry {
        group: "Self-healing eval",
        label: "Eval status",
        description: "Availability + last run summary.",
        invocation: "eval status",
        destructive: false,
    },
    CommandEntry {
        group: "Self-healing eval",
        label: "Run eval",
        description: "Start a self-healing eval run.",
        invocation: "eval run",
        destructive: false,
    },
    CommandEntry {
        group: "Self-healing eval",
        label: "Latest eval report",
        description: "Print the latest run report (JSON or Markdown).",
        invocation: "eval report",
        destructive: false,
    },
    CommandEntry {
        group: "Self-healing eval",
        label: "Suggest grounding",
        description: "Auto-suggest a topic+grounding from a subject's memories.",
        invocation: "eval grounding",
        destructive: false,
    },
    // Auth & config
    CommandEntry {
        group: "Configuration",
        label: "Sign in",
        description: "Authenticate against the admin server.",
        invocation: "auth login",
        destructive: false,
    },
    CommandEntry {
        group: "Configuration",
        label: "Sign out",
        description: "Drop the stored session.",
        invocation: "auth logout",
        destructive: false,
    },
    CommandEntry {
        group: "Configuration",
        label: "Auth status",
        description: "Is the stored session still valid?",
        invocation: "auth status",
        destructive: false,
    },
    CommandEntry {
        group: "Configuration",
        label: "Show config",
        description: "Print the resolved on-disk config.",
        invocation: "config show",
        destructive: false,
    },
    CommandEntry {
        group: "Configuration",
        label: "Config path",
        description: "Print the on-disk config file path.",
        invocation: "config path",
        destructive: false,
    },
];

pub fn groups() -> Vec<&'static str> {
    let mut out: Vec<&'static str> = Vec::new();
    for c in COMMANDS {
        if !out.contains(&c.group) {
            out.push(c.group);
        }
    }
    out
}

pub fn in_group(group: &str) -> Vec<&'static CommandEntry> {
    COMMANDS.iter().filter(|c| c.group == group).collect()
}
