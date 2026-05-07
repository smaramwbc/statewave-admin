//! clap derive tree.
//!
//! Layout (the tree the user types) is mirrored 1:1 by the static registry
//! in `index.rs` so the interactive menu and fuzzy search stay in sync.

use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Clone, Copy, ValueEnum, PartialEq, Eq)]
pub enum Format {
    Table,
    Json,
    Yaml,
}

impl From<Format> for statewave_admin_core::format::Format {
    fn from(value: Format) -> Self {
        match value {
            Format::Table => Self::Table,
            Format::Json => Self::Json,
            Format::Yaml => Self::Yaml,
        }
    }
}

#[derive(Debug, Clone, Copy, ValueEnum)]
pub enum Shell {
    Bash,
    Zsh,
    Fish,
    Powershell,
    Elvish,
}

#[derive(Debug, Parser)]
#[command(
    name = "statewave-admin",
    version,
    about = "CLI for the Statewave admin server",
    long_about = "Run any operation the Statewave admin web UI supports against a remote admin server. \
                  Use without arguments for an interactive menu, `--help` for the flat command tree, \
                  or `search <query>` for fuzzy lookup."
)]
pub struct Cli {
    /// Output format. Defaults to a table on a tty, JSON when piped.
    #[arg(long, value_enum, global = true)]
    pub format: Option<Format>,

    /// Skip confirmation prompts on destructive operations.
    #[arg(long, global = true)]
    pub yes: bool,

    /// Suppress non-result output (banners, hints, equivalent-command tips).
    #[arg(long, global = true)]
    pub quiet: bool,

    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Sign in / out of the admin server, inspect session.
    #[command(subcommand)]
    Auth(AuthCmd),

    /// Inspect / modify on-disk config.
    #[command(subcommand)]
    Config(ConfigCmd),

    /// One-shot dashboard summary (readiness, migration, counts).
    Dashboard,

    /// Usage windows for a tenant or globally.
    Usage {
        /// Tenant id (omit for global).
        #[arg(long)]
        tenant: Option<String>,
    },

    /// List the tenants the admin can see.
    Tenants,

    /// Subjects, memories, episodes, sessions.
    #[command(subcommand)]
    Subjects(SubjectsCmd),

    /// Compile jobs.
    #[command(subcommand)]
    Jobs(JobsCmd),

    /// Webhook delivery events.
    #[command(subcommand)]
    Webhooks(WebhooksCmd),

    /// .swmem export/import, starter packs, support reseed, clone.
    #[command(subcommand)]
    Memory(MemoryCmd),

    /// First-run smoke check.
    #[command(subcommand)]
    Smoke(SmokeCmd),

    /// Self-healing eval.
    #[command(subcommand)]
    Eval(EvalCmd),

    /// Read-only diagnostics (persona health).
    #[command(subcommand)]
    Diagnostics(DiagCmd),

    /// Open the interactive menu (also runs by default with no args + tty).
    Interactive,

    /// Fuzzy-search every subcommand.
    Search {
        /// Free-text query.
        query: Vec<String>,
    },

    /// Print shell completion script.
    Completions {
        #[arg(value_enum)]
        shell: Shell,
    },
}

// ─── auth ────────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum AuthCmd {
    /// Sign in with a password and persist the session in the OS keychain.
    Login {
        /// Admin server URL, e.g. https://admin.statewave.io.
        #[arg(long)]
        url: Option<String>,
        /// Read password from stdin instead of prompting.
        #[arg(long)]
        password_stdin: bool,
    },
    /// Drop the stored session.
    Logout,
    /// Show whether the session is still valid.
    Status,
}

// ─── config ──────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum ConfigCmd {
    /// Print the resolved config file.
    Show,
    /// Set a config field (currently: `url`, `default_format`).
    Set { key: String, value: String },
    /// Print the on-disk config path.
    Path,
}

// ─── subjects ────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum SubjectsCmd {
    /// List subjects.
    List {
        #[arg(long)]
        search: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long)]
        health_state: Option<String>,
        #[arg(long)]
        has_open_sessions: Option<bool>,
        #[arg(long)]
        sort_by: Option<String>,
        #[arg(long)]
        sort_order: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
    },
    /// Show a single subject's detail (summary, health, SLA).
    Show {
        subject_id: String,
        #[arg(long)]
        tenant: Option<String>,
    },
    /// List a subject's memories.
    Memories {
        subject_id: String,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        kind: Option<String>,
        #[arg(long)]
        search: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
    },
    /// List a subject's episodes.
    Episodes {
        subject_id: String,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long)]
        session: Option<String>,
        #[arg(long, name = "type")]
        episode_type: Option<String>,
        #[arg(long)]
        search: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
    },
    /// List a subject's sessions (open + resolved + SLA).
    Sessions {
        subject_id: String,
        #[arg(long)]
        tenant: Option<String>,
    },
    /// Print a session's full event timeline.
    Timeline {
        subject_id: String,
        session_id: String,
        #[arg(long)]
        tenant: Option<String>,
    },
    /// Delete a single subject (cascades to episodes + memories). Irreversible.
    Delete {
        subject_id: String,
        #[arg(long)]
        tenant: Option<String>,
    },
    /// Bulk-delete subjects matching a filter (with preview + drift protection).
    BulkDelete {
        #[arg(long)]
        prefix: Option<String>,
        #[arg(long)]
        older_than_days: Option<u32>,
        #[arg(long)]
        tenant: Option<String>,
        /// Required when no other selector is set.
        #[arg(long)]
        match_all: bool,
        /// Run only the preview, don't commit.
        #[arg(long)]
        preview_only: bool,
    },
    /// Clone a subject's memories/episodes into a new subject.
    Clone {
        source_subject_id: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        target_display_name: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
        /// `episodes` | `memories` | `episodes_and_memories` | `episodes_memories_sources`.
        #[arg(long)]
        scope: Option<String>,
    },
}

// ─── jobs ────────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum JobsCmd {
    /// List compile jobs.
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
    },
    /// Bulk-delete terminal compile jobs matching a filter.
    Purge {
        #[arg(long)]
        status: Option<String>,
        #[arg(long)]
        subject: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
    },
}

// ─── webhooks ────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum WebhooksCmd {
    /// List webhook delivery events.
    List {
        #[arg(long)]
        status: Option<String>,
        #[arg(long, name = "type")]
        event_type: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long, default_value_t = 50)]
        limit: u32,
        #[arg(long, default_value_t = 0)]
        offset: u32,
    },
    /// Bulk-delete terminal webhook events matching a filter.
    Purge {
        #[arg(long)]
        status: Option<String>,
        #[arg(long, name = "type")]
        event_type: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
    },
}

// ─── memory portability ─────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum MemoryCmd {
    /// Starter packs (built-in / bundled).
    #[command(subcommand)]
    Packs(PacksCmd),
    /// Statewave Support pack (the support docs subject).
    #[command(subcommand)]
    Support(SupportCmd),
    /// Encrypt and write a `.swmem` file.
    Export {
        /// One or more subject ids (repeat the flag).
        #[arg(long, required = true)]
        subject: Vec<String>,
        #[arg(long)]
        tenant: Option<String>,
        /// `episodes` | `memories` | `episodes_and_memories` (default) | `episodes_memories_sources`.
        #[arg(long)]
        scope: Option<String>,
        /// Output file path. `.swmem` extension recommended.
        #[arg(long)]
        out: String,
        /// Read passphrase from stdin instead of prompting.
        #[arg(long)]
        passphrase_stdin: bool,
    },
    /// Decrypt a `.swmem` file and import it into the connected server.
    Import {
        /// Path to the `.swmem` file.
        file: String,
        #[arg(long)]
        tenant: Option<String>,
        /// `create_copy` (default) | `merge` | `cancel`.
        #[arg(long)]
        conflict_strategy: Option<String>,
        /// Read passphrase from stdin instead of prompting.
        #[arg(long)]
        passphrase_stdin: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum PacksCmd {
    /// List available starter packs.
    List,
    /// Import a starter pack into a (new or existing) subject.
    Import {
        pack_id: String,
        #[arg(long)]
        target: Option<String>,
        #[arg(long)]
        target_display_name: Option<String>,
        #[arg(long)]
        tenant: Option<String>,
        #[arg(long)]
        conflict_strategy: Option<String>,
    },
}

#[derive(Debug, Subcommand)]
pub enum SupportCmd {
    /// Read the live Support subject's installed pack version + counts.
    State,
    /// Reseed the Support subject from the bundled pack.
    Reseed {
        #[arg(long)]
        reason: Option<String>,
        /// Force-reseed even if already up to date.
        #[arg(long)]
        force: bool,
    },
}

// ─── smoke ───────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum SmokeCmd {
    Status,
    Run,
}

// ─── eval ────────────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum EvalCmd {
    Status,
    /// Start a self-healing eval run.
    Run {
        /// `smoke` | `developer` | `full`.
        #[arg(long)]
        mode: Option<String>,
        #[arg(long)]
        max_level: Option<u8>,
        #[arg(long)]
        max_questions: Option<u32>,
        #[arg(long)]
        subject: Option<String>,
    },
    /// Print the latest eval report.
    Report {
        /// `json` (default) | `markdown`.
        #[arg(long, default_value = "json")]
        format: String,
    },
    /// Auto-suggest a topic + grounding from a subject's memories.
    Grounding {
        subject_id: String,
        #[arg(long)]
        max_memories: Option<u32>,
    },
}

// ─── diagnostics ─────────────────────────────────────────────────────────

#[derive(Debug, Subcommand)]
pub enum DiagCmd {
    /// Demo persona pack health (read-only).
    Personas {
        /// Re-run probes instead of returning the cached snapshot.
        #[arg(long)]
        force: bool,
    },
}
