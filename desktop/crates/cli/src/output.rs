use crate::cli::Format as CliFormat;
use console::style;
use serde_json::Value;
use statewave_admin_core::format::{render, Format};

/// Pick the effective output format: explicit flag > tty heuristic.
pub fn pick_format(explicit: Option<CliFormat>) -> Format {
    Format::auto(explicit.map(Into::into))
}

/// Print a JSON value in the chosen format. Newline appended.
pub fn print_value(value: &Value, format: Format) {
    println!("{}", render(value, format));
}

pub fn print_ok(msg: &str) {
    eprintln!("{} {}", style("✓").green().bold(), msg);
}

pub fn print_warn(msg: &str) {
    eprintln!("{} {}", style("!").yellow().bold(), msg);
}

pub fn print_err(msg: &str) {
    eprintln!("{} {}", style("✗").red().bold(), msg);
}

pub fn print_hint(msg: &str) {
    eprintln!("{} {}", style("·").dim(), style(msg).dim());
}

