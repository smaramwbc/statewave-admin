use anyhow::{anyhow, Result};
use statewave_admin_core::Config;

use crate::output;

pub fn show() -> Result<()> {
    let cfg = Config::load()?;
    let value = serde_json::to_value(&cfg)?;
    output::print_value(&value, statewave_admin_core::format::Format::Yaml);
    Ok(())
}

pub fn path() -> Result<()> {
    let p = Config::path()?;
    println!("{}", p.display());
    Ok(())
}

pub fn set(key: &str, value: &str) -> Result<()> {
    let mut cfg = Config::load().unwrap_or_default();
    match key {
        "url" => cfg.url = Some(value.to_string()),
        "default_format" => {
            if !matches!(value, "json" | "yaml" | "table") {
                return Err(anyhow!("default_format must be json | yaml | table"));
            }
            cfg.default_format = Some(value.to_string());
        }
        other => return Err(anyhow!("unknown config key: {other}")),
    }
    cfg.save()?;
    output::print_ok(&format!("set {key} = {value}"));
    Ok(())
}
