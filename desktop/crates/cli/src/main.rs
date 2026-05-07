use anyhow::Result;
use clap::{CommandFactory, Parser};
use clap_complete::generate;
use std::io::IsTerminal;
use std::process::ExitCode;
use statewave_admin_core::format::Format;
use statewave_admin_core::{AdminClient, Credentials};

mod cli;
mod handlers;
mod index;
mod interactive;
mod output;
mod search;
mod util;

use crate::cli::{Cli, Command, Shell};

fn main() -> ExitCode {
    let parsed = Cli::parse();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            output::print_err(&format!("could not start runtime: {e}"));
            return ExitCode::from(2);
        }
    };
    match runtime.block_on(run(parsed)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            output::print_err(&format!("{err:#}"));
            ExitCode::from(1)
        }
    }
}

async fn run(parsed: Cli) -> Result<()> {
    let format = output::pick_format(parsed.format);

    let cmd = match parsed.command {
        Some(c) => c,
        None => {
            // No subcommand: drop into interactive mode if we have a tty,
            // else print --help so pipelines don't hang on a prompt.
            if std::io::stdin().is_terminal() {
                interactive::run().await?;
                return Ok(());
            }
            Cli::command().print_help()?;
            println!();
            return Ok(());
        }
    };

    match cmd {
        // Commands that don't need an authenticated client.
        Command::Auth(a) => match a {
            cli::AuthCmd::Login {
                url,
                password_stdin,
            } => handlers::auth::login(url, password_stdin).await?,
            cli::AuthCmd::Logout => handlers::auth::logout().await?,
            cli::AuthCmd::Status => handlers::auth::status().await?,
        },
        Command::Config(c) => match c {
            cli::ConfigCmd::Show => handlers::config_cmd::show()?,
            cli::ConfigCmd::Set { key, value } => handlers::config_cmd::set(&key, &value)?,
            cli::ConfigCmd::Path => handlers::config_cmd::path()?,
        },
        Command::Search { query } => {
            let q = query.join(" ");
            interactive::search_and_print(&q);
        }
        Command::Completions { shell } => emit_completions(shell),
        Command::Interactive => interactive::run().await?,

        // Commands that DO need an authenticated client.
        other => {
            let creds = Credentials::load()?;
            let client = AdminClient::from_credentials(&creds)?;
            run_authed(&client, other, format, parsed.yes, parsed.quiet).await?;
        }
    }
    Ok(())
}

async fn run_authed(
    client: &AdminClient,
    cmd: Command,
    format: Format,
    yes: bool,
    quiet: bool,
) -> Result<()> {
    match cmd {
        Command::Dashboard => handlers::overview::dashboard(client, format).await?,
        Command::Usage { tenant } => {
            handlers::overview::usage(client, tenant.as_deref(), format).await?
        }
        Command::Tenants => handlers::overview::tenants(client, format).await?,
        Command::Subjects(s) => handlers::subjects::run(client, s, format, yes, quiet).await?,
        Command::Jobs(j) => handlers::jobs::run(client, j, format, yes, quiet).await?,
        Command::Webhooks(w) => handlers::webhooks::run(client, w, format, yes, quiet).await?,
        Command::Memory(m) => handlers::memory::run(client, m, format).await?,
        Command::Smoke(s) => handlers::smoke::run(client, s, format).await?,
        Command::Eval(e) => handlers::eval::run(client, e, format).await?,
        Command::Diagnostics(d) => handlers::diagnostics::run(client, d, format).await?,
        Command::Auth(_)
        | Command::Config(_)
        | Command::Search { .. }
        | Command::Completions { .. }
        | Command::Interactive => unreachable!("handled in run()"),
    }
    Ok(())
}

fn emit_completions(shell: Shell) {
    let mut cmd = Cli::command();
    let bin = cmd.get_name().to_string();
    let stdout = std::io::stdout();
    let mut out = stdout.lock();
    match shell {
        Shell::Bash => generate(clap_complete::shells::Bash, &mut cmd, &bin, &mut out),
        Shell::Zsh => generate(clap_complete::shells::Zsh, &mut cmd, &bin, &mut out),
        Shell::Fish => generate(clap_complete::shells::Fish, &mut cmd, &bin, &mut out),
        Shell::Powershell => generate(
            clap_complete::shells::PowerShell,
            &mut cmd,
            &bin,
            &mut out,
        ),
        Shell::Elvish => generate(clap_complete::shells::Elvish, &mut cmd, &bin, &mut out),
    }
}
