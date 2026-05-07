use anyhow::{anyhow, Result};
use std::io::{self, Read};
use statewave_admin_core::{AdminClient, Config, Credentials};

use crate::output;

pub async fn login(url: Option<String>, password_stdin: bool) -> Result<()> {
    let url = match url {
        Some(u) => u,
        None => {
            let cfg = Config::load().unwrap_or_default();
            match cfg.url {
                Some(u) => u,
                None => inquire::Text::new("Admin server URL:")
                    .with_placeholder("https://admin.statewave.io")
                    .prompt()?,
            }
        }
    };
    let password = read_password(password_stdin)?;
    let mut client = AdminClient::anonymous(&url)?;
    client.login(&password).await?;
    let cookie = client
        .session_cookie()
        .ok_or_else(|| anyhow!("login succeeded but no session cookie was issued"))?
        .to_string();
    Credentials {
        url: url.clone(),
        cookie,
    }
    .save()?;
    output::print_ok(&format!("signed in to {url}"));
    Ok(())
}

pub async fn logout() -> Result<()> {
    if let Ok(creds) = Credentials::load() {
        let mut client = AdminClient::from_credentials(&creds)?;
        let _ = client.logout().await;
    }
    Credentials::clear()?;
    output::print_ok("signed out");
    Ok(())
}

pub async fn status() -> Result<()> {
    let creds = match Credentials::load() {
        Ok(c) => c,
        Err(_) => {
            output::print_warn("no stored session — run `statewave-admin auth login`");
            return Ok(());
        }
    };
    let client = AdminClient::from_credentials(&creds)?;
    let v = client.session_status().await?;
    let authed = v
        .get("authenticated")
        .and_then(|b| b.as_bool())
        .unwrap_or(false);
    if authed {
        output::print_ok(&format!("signed in to {}", creds.url));
    } else {
        output::print_warn("session is no longer valid — run `statewave-admin auth login`");
    }
    Ok(())
}

fn read_password(stdin: bool) -> Result<String> {
    if stdin {
        let mut buf = String::new();
        io::stdin().read_to_string(&mut buf)?;
        Ok(buf.trim_end_matches(['\n', '\r']).to_string())
    } else {
        Ok(inquire::Password::new("Admin password:")
            .without_confirmation()
            .with_display_mode(inquire::PasswordDisplayMode::Masked)
            .prompt()?)
    }
}
